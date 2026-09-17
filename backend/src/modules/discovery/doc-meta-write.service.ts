import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * タグ書き込みの再試行回数。
 *
 * ⚠️ 競合は「同じページのタグを同時に触った人数」ぶんしか起きない。
 * 数回で十分で、増やすと詰まったときの待ち時間が延びるだけ。
 */
const TAG_WRITE_ATTEMPTS = 5;
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionService } from '../permission/permission.service';
import { DocGcService } from './doc-gc.service';
import { DiscoveryRevisionService } from './discovery-revision.service';

/**
 * #151 段階3: Discovery Metadata をサーバーへ書き込む。
 *
 * ## 値型と操作型を分ける
 *
 * | 種類 | 対象 | 競合制御 |
 * |---|---|---|
 * | **値型** | `title` / `trash` | **フィールド単位の版数** |
 * | **操作型** | `tags` の add / remove | **不要**（順序に依存しない） |
 *
 * タグを「値」として送ると、2人が別のタグを付けたときに一方が消える
 * （#164 と同じ形）。**操作として送ること。**
 *
 * ## ⚠️ 移行期間の扱い
 *
 * 版数は移行判定にも兼用している（7.7）。
 * `doc-meta-sync` は版数を上げないため、**移行前は版数だけでは stale を
 * 検出できない**。移行前の1回目だけ「利用者が見ていた値」と突き合わせる。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.5.10 / 7.7
 */
@Injectable()
export class DocMetaWriteService {
  private readonly logger = new Logger(DocMetaWriteService.name);

  constructor(
    private prisma: PrismaService,
    private permission: PermissionService,
    private discovery: DiscoveryRevisionService,
    private audit: AuditService,
    // #45: 完全削除で消すものは DocGcService が1か所で持つ
    private gc: DocGcService,
  ) {}

  /**
   * ページを台帳へ登録する。
   *
   * ⚠️ **段階3 で必要になった口。** それまでは `doc-meta-sync` が Yjs 目次を
   * 見て行を作っていた。目次にメタデータを書かなくなると、
   * **その経路が無くなり、新しいページが一覧に出なくなる**。
   *
   * ⚠️ **版数を 1 から始める。** 0 は「まだ台帳が持っていない（Yjs が正）」
   * を意味する移行判定の値であり（7.7.2）、新規ページに使うと
   * **`doc-meta-sync` に上書きされる余地を残す**。
   *
   * ⚠️ **すでに行があれば何もしない。** 作成は再送され得るため
   * （通信断・複数タブ）、冪等にしないと**題を作りたての空へ戻す**。
   */
  async createDoc(params: {
    workspaceId: string;
    docId: string;
    userId: string;
    title: string;
    mode: string;
  }): Promise<DocMetaWriteResult> {
    const { workspaceId, docId, userId, title, mode } = params;

    // ⚠️ **作成そのものは読まずに行う。** 「無いことを読んでから作る」に
    // すると、複数タブや再送で同時に来たとき両方が「無い」を読んでから
    // 作りにいき、**一意制約違反で片方が落ちる**。upsert は原子的で、
    // 既にあれば何もしない（冪等）。
    //
    // ⚠️ ここで読むのは**版数を上げるかどうかの判断のためだけ**。
    // 同時作成では両方が「新規」と見なして二重に上げ得るが、
    // 版数が余分に進むだけで害は無い（作成そのものは壊れない）。
    const before = await this.prisma.docMeta.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
      select: { docId: true },
    });

    const created = await this.prisma.docMeta.upsert({
      where: { workspaceId_docId: { workspaceId, docId } },
      create: {
        workspaceId,
        docId,
        title,
        mode,
        createdById: userId,
        updatedById: userId,
        updatedAt: new Date(),
        // ⚠️ 版数は 1 から。0 は「まだ台帳が持っていない（Yjs が正）」を
        // 意味する移行判定の値（7.7.2）
        titleRevision: 1n,
        trashRevision: 1n,
        tagsRevision: 1n,
      },
      // ⚠️ **既にあるなら何も変えない。** 変えると、再送のたびに
      // 付けた題を作りたての空へ戻す
      update: {},
      // ⚠️ **3つとも取り出すこと。** 作成直後の書き込みは、この版数を
      // 基準に CAS する。title だけ返すと、trash / tags の書き込みが
      // 基準を持たないまま 0 で送られ、**必ず stale になる**（7.12）
      select: {
        titleRevision: true,
        trashRevision: true,
        tagsRevision: true,
      },
    });

    const revisions = {
      title: created.titleRevision,
      trash: created.trashRevision,
      tags: created.tagsRevision,
    };

    // 既にあったなら版数を上げない（何も変わっていないのに
    // 全員のキャッシュを失効させない）
    if (before) {
      return { status: 'ok', revision: created.titleRevision, revisions };
    }

    // ⚠️ 版数は書き込んだ「あと」に上げる（先に上げると、その間に
    // Snapshot を取った利用者が新しい版数と古い一覧を固定してしまう）
    await this.discovery.bump(workspaceId, 'doc-create');
    return { status: 'ok', revision: created.titleRevision, revisions };
  }

  /**
   * ページを台帳から消す。
   *
   * ⚠️ **無くても失敗にしない。** 削除は再送され得るし、
   * そもそも台帳に無いページを消そうとするのは矛盾ではない。
   */
  async deleteDoc(params: {
    workspaceId: string;
    docId: string;
    userId: string;
  }): Promise<DocMetaWriteResult> {
    const { workspaceId, docId, userId } = params;

    // ⚠️ **ワークスペースのメンバーであることだけでは足りない。**
    // 判定を落とすと、**編集できないページを誰でも台帳から消せる**
    // ＝全員の一覧から消える。判定は PermissionService に委ねる
    await this.requireDelete(workspaceId, docId, userId);

    // ⚠️ #45: 台帳の行だけでなく**本文と索引も**消す。
    // 残すと孤児になるだけでなく、消したページが検索に出続ける
    // （docs/permanent-delete.md 4章）
    await this.gc.purge(workspaceId, docId);
    return { status: 'ok' };
  }

  /**
   * 題を変更する。
   *
   * @param baseRevision クライアントが基準にした版数
   */
  async setTitle(params: {
    workspaceId: string;
    docId: string;
    userId: string;
    title: string;
    baseRevision: bigint;
  }): Promise<DocMetaWriteResult> {
    return this.writeValueField({
      ...params,
      field: 'title',
      value: params.title,
      reason: 'doc-update',
    });
  }

  /**
   * ゴミ箱へ入れる / 戻す。
   *
   * ⚠️ ゴミ箱の状態はこれまで Yjs 目次にしか無く、サーバーは持っていなかった。
   * ここで初めてサーバー側の操作になる（`discovery-revision.service.ts` の注記）。
   */
  async setTrash(params: {
    workspaceId: string;
    docId: string;
    userId: string;
    trash: boolean;
    baseRevision: bigint;
  }): Promise<DocMetaWriteResult> {
    return this.writeValueField({
      ...params,
      field: 'trash',
      value: params.trash,
      reason: params.trash ? 'doc-trash' : 'doc-restore',
    });
  }

  /**
   * タグを**要素単位**で足す / 外す。
   *
   * ⚠️ **版数で弾かない。** 操作型は何度でも・どの順でも同じ結果になるため、
   * 再送や順序の入れ替わりで壊れない。版数は移行判定にのみ使う。
   */
  async changeTags(params: {
    workspaceId: string;
    docId: string;
    userId: string;
    add: string[];
    remove: string[];
  }): Promise<DocMetaWriteResult> {
    const { workspaceId, docId, userId, add, remove } = params;

    await this.requireUpdate(workspaceId, docId, userId);

    // ⚠️ **読んで書くだけでは足りない。**
    // 2人が同時に別のタグを足すと、両方が同じ `tagIds` から配列を作り、
    // 後から書いたほうが先のタグを消す。**操作型 API で避けたい競合そのもの。**
    // 版数を条件に入れた更新（CAS）にし、外れたら読み直して再試行する。
    for (let attempt = 0; attempt < TAG_WRITE_ATTEMPTS; attempt++) {
      const current = await this.prisma.docMeta.findUnique({
        where: { workspaceId_docId: { workspaceId, docId } },
        select: { tagIds: true, tagsRevision: true },
      });
      if (!current) return { status: 'not-found' };

      const removeSet = new Set(remove);
      const next = current.tagIds.filter((t) => !removeSet.has(t));
      for (const tag of add) {
        if (!removeSet.has(tag) && !next.includes(tag)) next.push(tag);
      }

      const migrating = current.tagsRevision === 0n;
      const unchanged = this.sameTags(current.tagIds, next);

      // 移行後は、変わらないなら何もしない（版数を上げると全員のキャッシュが失効する）
      if (unchanged && !migrating) {
        return { status: 'ok', revision: current.tagsRevision };
      }

      // ⚠️ **移行前は、内容が変わらなくても所有権を取る**（版数を 0 から進める）。
      // 取らないと未移行のままになり、**doc-meta-sync が目次のタグで上書きする**。
      const result = await this.prisma.docMeta.updateMany({
        // ⚠️ 版数を条件に含めるのが要点。読んだ時点から変わっていたら 0 件になる
        where: { workspaceId, docId, tagsRevision: current.tagsRevision },
        data: {
          ...(unchanged ? {} : { tagIds: next, updatedById: userId }),
          tagsRevision: { increment: 1 },
        },
      });

      if (result.count === 0) continue; // 誰かが先に書いた。読み直してやり直す

      // ⚠️ 一覧に出る内容が変わっていないなら版数を上げない。
      // 所有権を取っただけで全員のキャッシュを失効させない
      if (!unchanged) {
        await this.discovery.bump(workspaceId, 'doc-update');
      }
      return { status: 'ok', revision: current.tagsRevision + 1n };
    }

    // ⚠️ **ここで stale を返さないこと。**
    // stale は「未送信分を捨てろ」という意味を持つ（7.5.10）。
    // 混み合っただけで捨てさせると、利用者のタグ操作が消える。
    // 例外にすればクライアントは保持して再送する（失敗の4分類の「5xx」）
    throw new ServiceUnavailableException(
      'タグの更新が競合しました。しばらくしてからやり直してください',
    );
  }

  // ───────────────────────────── 内部

  private sameTags(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((t, i) => t === b[i]);
  }

  /**
   * 値型フィールドの書き込み。**stale 判定はここに1箇所だけ置く。**
   */
  private async writeValueField(params: {
    workspaceId: string;
    docId: string;
    userId: string;
    field: 'title' | 'trash';
    value: string | boolean;
    baseRevision: bigint;
    reason: 'doc-update' | 'doc-trash' | 'doc-restore';
  }): Promise<DocMetaWriteResult> {
    const { workspaceId, docId, userId, field, value, baseRevision } = params;

    await this.requireUpdate(workspaceId, docId, userId);

    const revisionField = field === 'title' ? 'titleRevision' : 'trashRevision';

    const current = await this.prisma.docMeta.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
      select: { title: true, trash: true, titleRevision: true, trashRevision: true },
    });
    if (!current) return { status: 'not-found' };

    const storedRevision = current[revisionField];
    const storedValue = field === 'title' ? current.title : current.trash;

    // #151 段階3: **版数だけで判定する**（7.7.5 で移行判定を撤去）。
    //
    // かつては「版数 0 なら Yjs 目次が正」として、見ていた値そのものを
    // 突き合わせていた（7.7.4）。`doc-meta-sync` が**版数を上げずに値を
    // 書き換える**ため、版数では判定できなかったからである。
    // その同期を撤去した以上、**版数を動かさずに値が変わる経路は無い**。
    //
    // ⚠️ 値の比較を足さないこと。同じ値への変更を拒否してしまう
    if (storedRevision !== baseRevision) {
      return {
        status: 'stale',
        revision: storedRevision,
        currentTitle: current.title,
        currentTrash: current.trash,
      };
    }

    const unchanged = storedValue === value;

    // 変わらないなら何もしない（版数を上げると全員のキャッシュが失効する）
    if (unchanged) {
      return { status: 'ok', revision: storedRevision };
    }

    // ⚠️ **検査と更新を1つの操作にする。**
    // 読んでから無条件に書くと、同じ `baseRevision` を持つ2件が並行したとき
    // **両方とも検査を通って両方とも書き込み、後勝ちで一方が消える**。
    // しかも両方に ok を返すため、競合制御が働いていないことに気づけない。
    //
    const result = await this.prisma.docMeta.updateMany({
      where: { workspaceId, docId, [revisionField]: baseRevision },
      data: {
        ...(unchanged ? {} : { [field]: value, updatedById: userId }),
        [revisionField]: { increment: 1 },
      },
    });

    if (result.count === 0) {
      // 読んだ時点から変わっていた。**現在値を読み直して返す**
      // （クライアントが「取ってから捨てる」ために要る・7.5.10）
      return this.staleFrom(workspaceId, docId, revisionField);
    }

    // ⚠️ 一覧に出る内容が変わっていないなら版数を上げない。
    // 所有権を取っただけで全員のキャッシュを失効させない
    if (!unchanged) {
      await this.discovery.bump(workspaceId, params.reason);
    }

    // #136: ゴミ箱の出し入れを監査ログに残す。ここに来るのは値が変わったときだけ
    // （同じ値・stale・not-found は上で返している。docs/logging.md 2.6）
    if (field === 'trash') {
      await this.recordTrash(
        workspaceId,
        docId,
        userId,
        value === true,
        current.title,
      );
    }
    return { status: 'ok', revision: storedRevision + 1n };
  }

  /**
   * #136: ゴミ箱へ移動 / ゴミ箱から戻すを記録する。
   *
   * ⚠️ Interceptor では記録しない。`setDocTrash` は競合も同じ値への変更も
   * 例外にせず結果で返すため、何も変わらない操作まで残ってしまう。
   */
  private async recordTrash(
    workspaceId: string,
    docId: string,
    userId: string,
    trash: boolean,
    title: string | null,
  ) {
    // 画面・CSV・絞り込みは actorEmail を見る。id だけだと 'anonymous' になる
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    await this.audit.record({
      action: trash ? 'doc.trash' : 'doc.untrash',
      actor: { id: userId, email: actor?.email, name: actor?.name },
      targetType: 'doc',
      targetId: docId,
      targetName: title ?? undefined,
      workspaceId,
    });
  }

  /** 現在値を読み直して stale を返す。 */
  private async staleFrom(
    workspaceId: string,
    docId: string,
    revisionField: 'titleRevision' | 'trashRevision',
  ): Promise<DocMetaWriteResult> {
    const now = await this.prisma.docMeta.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
      select: { title: true, trash: true, titleRevision: true, trashRevision: true },
    });
    if (!now) return { status: 'not-found' };
    return {
      status: 'stale',
      revision: now[revisionField],
      currentTitle: now.title,
      currentTrash: now.trash,
    };
  }

  /**
   * 書き込み権限を確かめる。
   *
   * ⚠️ **判定を散らさない。** `PermissionService` だけに委ね、
   * ここに `if` で条件を書かない（docs/doc-permission.md）。
   */
  private async requireDelete(
    workspaceId: string,
    docId: string,
    userId: string,
  ): Promise<void> {
    const allowed = await this.permission.canDelete(workspaceId, docId, userId);
    if (!allowed) {
      // ⚠️ 「権限が無い」と「存在しない」を区別させない（#151 の目的）
      throw new ForbiddenException('このページを削除する権限がありません');
    }
  }

  private async requireUpdate(
    workspaceId: string,
    docId: string,
    userId: string,
  ): Promise<void> {
    const allowed = await this.permission.canUpdate(workspaceId, docId, userId);
    if (!allowed) {
      // ⚠️ 「権限が無い」と「存在しない」を、利用者からは区別できないようにする。
      // 区別できると、権限外のページの存在が分かってしまう（#151 の目的）
      throw new ForbiddenException('このページを編集する権限がありません');
    }
  }
}

/**
 * 書き込みの結果。
 *
 * ⚠️ **「失敗」を1つにまとめないこと。** クライアントは扱いを分ける
 * （docs/discovery-stage3-comparison.md 7.5.10）。
 *
 * | 結果 | クライアントの扱い |
 * |---|---|
 * | `ok` | 未送信分を破棄してよい |
 * | `stale` | 未送信分を破棄し、**返した現在値をローカルへ反映してから**捨てる |
 * | `not-found` | 台帳に行が無い。再取得する |
 *
 * 権限が無い場合は例外（`ForbiddenException`）。
 */
export interface DocMetaWriteResult {
  status: 'ok' | 'stale' | 'not-found';
  /** 書き込み後（stale なら現在）の版数 */
  revision?: bigint;
  /** ⚠️ stale のときだけ返す。クライアントが「取ってから捨てる」ために要る（7.5.10） */
  currentTitle?: string | null;
  currentTrash?: boolean;
  /**
   * #151 段階3: **作成のときだけ返す、3フィールドそれぞれの版数**（7.12）。
   *
   * ⚠️ クライアントに「作成時は全部 1」と推測させないため、
   * **実際の値をそのまま返す**。`createDoc` は冪等な upsert なので、
   * 再送では既にある行の版数が返る。
   */
  revisions?: { title: bigint; trash: bigint; tags: bigint };
}
