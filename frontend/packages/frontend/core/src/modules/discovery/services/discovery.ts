import { Service } from '@toeverything/infra';

import { classifyFailure, decideDiscoverySource } from '../decide';
import { InvalidRevisionError } from '../stores/discovery';
import type {
  DiscoveryCacheEntry,
  DiscoveryCacheStore,
} from '../stores/discovery-cache';
import type { DiscoveryStore } from '../stores/discovery';

/**
 * #151: Discovery Index を「使ってよい形」で提供する。
 *
 * > **⚠️ キャッシュは権限情報の正本ではない。**
 * > **認可済み Snapshot の一時的な複製である。**
 *
 * ## いつキャッシュを使ってよいか
 *
 * | 状況 | 振る舞い |
 * |---|---|
 * | サーバーに繋がる・版数が一致 | キャッシュを使う |
 * | サーバーに繋がる・版数が違う | **取り直す**（キャッシュを信用しない） |
 * | **サーバーに繋がらない** | **最後の認可済み Snapshot を使う**（例外として許容） |
 *
 * ⚠️ **サーバーに接続できる状態で、古いキャッシュだけを根拠に**
 * **表示し続けてはならない。** TTL で権限失効を遅らせない。
 *
 * オフラインを例外として許すのは、一覧を全部隠すと Wiki として
 * 使い物にならないため。「オフライン中に権限を剥奪された利用者の手元に
 * 古いタイトルが残る」ことは技術的に避けられず、
 * **避けられないものを禁止と書くより、例外として明示する**方針とした。
 *
 * 詳細は `docs/doc-permission.md`「Discovery Index Local Cache」。
 */
export class DiscoveryService extends Service {
  constructor(
    private readonly store: DiscoveryStore,
    private readonly cache: DiscoveryCacheStore
  ) {
    super();
  }

  /**
   * 別タブの更新を含めて、キャッシュの変化を知らせる。
   *
   * ⚠️ **段階3 では、これがタブ間伝播の唯一の経路になる。**
   * いままでは Yjs 目次が担っていた（片方のタブの編集が目次を動かし、
   * もう片方が取り直す）。目次を捨てると、その経路が無くなる。
   */
  watch(workspaceId: string, userId: string) {
    return this.cache.watch(workspaceId, userId);
  }

  /**
   * 一覧を返す。必要なら取り直す。
   *
   * @param userId 現在の利用者。**キャッシュの正当性判定に要る**
   */
  async load(
    workspaceId: string,
    userId: string
  ): Promise<{ entry: DiscoveryCacheEntry; source: DiscoverySource }> {
    const cached = await this.cache.get(workspaceId, userId);

    let serverRevision: string | null = null;
    let failure: ReturnType<typeof classifyFailure> | undefined;
    try {
      serverRevision = await this.store.fetchRevision(workspaceId);
    } catch (e) {
      // ⚠️ **サーバーの応答が壊れている場合は、オフライン扱いにしない。**
      // 「繋がらないから古いキャッシュを使う」は、通信できないときの
      // 例外規定であって、**応答が異常なときの逃げ道ではない**。
      // ここを混ぜると、サーバーが null を返すだけで
      // **オンラインなのに古い一覧を使い続ける**
      if (e instanceof InvalidRevisionError) throw e;

      // ⚠️ **「繋がらない」と「拒否された」を区別する。**
      // 混ぜると、どちらかの向きに必ず害が出る（下記 classifyFailure）
      failure = classifyFailure(e);
      serverRevision = null;
    }

    // ⚠️ **判定は decideDiscoverySource が持つ。** ここに条件を書かない
    // （書き始めると、仕様が実装のあちこちに散る）
    const decision = decideDiscoverySource({ cached, serverRevision, failure });

    if (decision === 'use-cache') return { entry: cached!, source: 'cache' };
    if (decision === 'use-offline-cache') {
      return { entry: cached!, source: 'offline-cache' };
    }
    if (decision === 'fail') {
      // ⚠️ 拒否されたなら、手元の複製も捨てる（見せてはいけないものが残る）
      if (failure === 'rejected') await this.cache.clear(workspaceId, userId);
      throw new Error(
        failure === 'rejected'
          ? 'Discovery Index を取得できません（権限がありません）'
          : 'Discovery Index を取得できません（オフラインで手元にもありません）',
      );
    }

    // ⚠️ **ここでも拒否されうる。** 版数を取ってから一覧を取るまでの間に
    // 権限を剥奪されると、`fetchSnapshot` が拒否される。
    // 素通りさせると**古いキャッシュが残り、次にオフラインになったとき
    // それを見せてしまう**
    let fresh: DiscoveryCacheEntry;
    try {
      fresh = await this.store.fetchSnapshot(workspaceId);
    } catch (e) {
      if (classifyFailure(e) === 'rejected') {
        await this.cache.clear(workspaceId, userId);
        throw new Error('Discovery Index を取得できません（権限がありません）');
      }
      // ⚠️ **版数が違うと分かっている場合は、キャッシュを使ってはいけない。**
      // ここへ来た時点でサーバーには**到達できている**（版数を取れた）。
      // 「権限が変わったので取り直す」途中で 502 になっただけであり、
      // 古い一覧を見せてよい理由にはならない。
      // オフラインの例外は**サーバーに到達できないとき**の規定である。
      //
      // 版数を取れなかった（＝到達できない）場合は、そもそも
      // decideDiscoverySource が use-offline-cache を返し、
      // ここまで来ない。
      throw e;
    }

    // ⚠️ **返してもいけない。** 保存しないだけでは、呼び出し側が
    // 別人の一覧をそのまま画面に出す。
    // ⚠️ **利用者だけでなくワークスペースも照合する。**
    // 別ワークスペースの結果を受け取ると、別の鍵で保存したうえに
    // **そのまま画面へ返す**ことになる
    if (fresh.userId !== userId || fresh.workspaceId !== workspaceId) {
      await this.cache.clear(workspaceId, userId);
      throw new Error(
        'Discovery Index の取得結果が要求と一致しません（表示しません）',
      );
    }

    await this.cache.set(fresh);
    return { entry: fresh, source: 'server' };
  }

  /**
   * 権限が変わったことを受けて、手元の複製を捨てる。
   *
   * ⚠️ **これは即時失効のための経路。** revision による検出は
   * 「通知を取り逃したとき」の保険であり、こちらが本筋。
   *
   * ⚠️ 捨てるのは①の層（永続キャッシュ）だけ。
   * ②Runtime Store・③UI 由来の状態は、呼び出し側が併せて捨てること
   * （仕様書「Invalidation の対象」）。
   */
  async invalidate(workspaceId: string, userId: string): Promise<void> {
    await this.cache.clear(workspaceId, userId);
  }

  /**
   * サインアウト時に、その利用者の複製をすべて捨てる。
   *
   * ⚠️ 鍵を `userId` で区切っても**データは端末に残る**。
   * 共用 PC で次の利用者に前の人のタイトルが残らないようにする。
   */
  async clearUser(userId: string): Promise<void> {
    await this.cache.clearUser(userId);
  }
}

/** その一覧がどこから来たか。**表示や記録の判断に使う。** */
export type DiscoverySource =
  | 'server'
  /** 版数がサーバーと一致したキャッシュ */
  | 'cache'
  /** ⚠️ サーバーに繋がらず、確認できないまま使ったキャッシュ */
  | 'offline-cache';
