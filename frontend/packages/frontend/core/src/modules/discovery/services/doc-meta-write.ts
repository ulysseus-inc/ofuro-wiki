import type { DocMeta } from '@blocksuite/affine/store';
import { Service } from '@toeverything/infra';

import {
  classifyWriteOutcome,
  shouldDiscardPending,
  shouldKeepPending,
} from '../classify-write-failure';
import { FieldQueue } from '../field-queue';
import { planReconcile } from '../reconcile';
import type { ReconcilePatch, ServerDocMeta } from '../reconcile';
import {
  isCreate,
  ownerChanged,
  samePending,
  selectResendable,
  toWritePlan,
} from '../resend-plan';
import { isEmptyPending, mergePending } from '../merge-pending';
import {
  type FieldRevisions,
  type MetaWritePlan,
  MISSING_REVISIONS,
  planMetaWrite,
} from '../plan-meta-write';
import type {
  DocMetaWriteResult,
  DocMetaWriteStore,
} from '../stores/doc-meta-write';
import type {
  PendingTarget,
  PendingWrite,
  PendingWriteStore,
} from '../stores/pending-write';

/**
 * #151 段階3: ローカルの変更をサーバーへ送る。
 *
 * ⚠️ **ローカルへ反映したあとに呼ばれる。**（7.5.2 の write-through）
 * ここで待たせると `createDoc` の同期連鎖が壊れる（7.5.1 で実験済み）。
 *
 * ## この段階（PR2b-1）でやること
 *
 * 送るところまで。**失敗の扱いは次の段階**（7.5.10）。
 * いまは失敗しても記録に残すだけで、再送も巻き戻しもしない。
 * ⚠️ Yjs にも書き続けているため、失敗しても**利用者の変更は失われない**
 * （台帳が移行済みにならないだけ）。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.5.2 / 7.5.10 / 7.7
 */
export class DocMetaWriteService extends Service {
  constructor(
    private readonly store: DocMetaWriteStore,
    // #151 段階3: 送れなかった変更を控える（7.5.8）
    private readonly pending: PendingWriteStore
  ) {
    super();
  }

  /**
   * 誰の変更として控えるか。
   *
   * ⚠️ **未サインインでは控えない。** 誰の変更か決められず、
   * 共用 PC で別の利用者の分として送りかねない。
   */
  userId?: string;

  private readonly logger = {
    warn: (message: string, error?: unknown) =>
      console.warn(`[DocMetaWrite] ${message}`, error ?? ''),
  };

  /**
   * stale だったときに呼ぶ。
   *
   * ⚠️ **「取ってから捨てる」**（7.5.10 の7）。サーバーが返した現在値を
   * ローカルへ反映してから未送信分を捨てる。順序を逆にすると、
   * **送る当ての無い値がキャッシュに残る**。
   *
   * ⚠️ 現状は未送信キューがまだ無いため（PR3）、ここでは現在値の反映だけを扱う。
   */
  onStale?: (
    docId: string,
    /** ⚠️ **stale になったフィールドだけ**を渡す。他は触らせない */
    field: MetaWritePlan['field'],
    result?: DocMetaWriteResult
  ) => void;

  /**
   * 権限が無くて書けなかったときに呼ぶ。
   *
   * ⚠️ **利用者に伝えること。** 操作が通らなかったのだから、
   * 黙って消してはいけない（原則2）。stale とは扱いを分ける。
   */
  onForbidden?: (
    docId: string,
    /** ⚠️ **拒否されたフィールドだけ**を渡す。他は触らせない */
    field: MetaWritePlan['field']
  ) => void;

  /**
   * 版数の控え。**サーバーが返した最新の版数を覚えておく。**
   *
   * ⚠️ 台帳を取り直すまで待つと、続けて変更したときに古い版数で送ってしまい
   * **自分の直前の変更に負けて stale になる**。
   */
  private readonly revisions = new Map<string, FieldRevisions>();

  /**
   * フィールドごとの**送信の順番待ち**。
   *
   * ⚠️ **編集した順に送ること。** `send()` は待たないため、同じフィールドを
   * 続けて編集すると呼び出しごとに別の非同期の鎖が走り、**応答の順が編集の
   * 順と一致しない**。壊れ方の詳細は `FieldQueue` に書いた。
   */
  private readonly queues = new FieldQueue();

  /**
   * 手元が知っている版数を返す（#151 段階3）。
   *
   * ⚠️ 台帳の取り込みが**手元の新しい値を潰さない**ようにするために要る
   * （`keepNewerLocal`）。
   */
  knownRevisions(docId: string): FieldRevisions | undefined {
    return this.revisions.get(docId);
  }

  /** 台帳から取った版数を取り込む。 */
  hydrateRevisions(
    docs: Array<{
      id: string;
      titleRevision: string;
      trashRevision: string;
      tagsRevision: string;
    }>
  ): void {
    for (const d of docs) {
      this.revisions.set(d.id, {
        title: d.titleRevision,
        trash: d.trashRevision,
        tags: d.tagsRevision,
      });
    }
  }

  /**
   * 変更をサーバーへ送る。**待たない。**
   *
   * @param before 変更前のメタ。タグの差分と、移行期間に必要な
   *   「利用者が見ていた値」を出すために要る（7.7.4）
   */
  send(
    workspaceId: string,
    docId: string,
    props: Partial<DocMeta>,
    before: DocMeta
  ): void {
    // ⚠️ 待たない。呼び出し元は Yjs のトランザクション直後にいる
    void this.sendAll(workspaceId, docId, props, before);
  }

  /**
   * ページを作ったことを台帳へ知らせる（#151 段階3）。
   *
   * ⚠️ **待たない。** 呼び出し元は `createDoc` の同期連鎖の中にいる
   * （7.5.1 で実験済み。サーバー先行は採れない）。
   *
   * ⚠️ 失敗しても**控えない**。作成は「そのページが存在する」という
   * 事実であって、値の変更ではない。取り直しの契機で台帳を引き直せば
   * 済む——**とはいえ、作成が届かないとページは一覧に出ない**ので、
   * 失敗は記録に残す。
   */
  created(workspaceId: string, docId: string, title: string, mode: string): void {
    const owner = this.userId;
    const done = this.queues.add(`${workspaceId}:${docId}:create`, async () => {
      // ⚠️ **送る前に控える。** 送信中にタブを閉じたり通信が切れたりすると、
      // 台帳に載らないまま**再読み込みで一覧から消える**（本文だけ残る）
      if (owner) {
        await this.pending
          .put({
            workspaceId,
            userId: owner,
            docId,
            field: 'create',
            title,
            mode,
          })
          .catch(() => undefined);
      }

      try {
        const result = await this.store.createDoc({
          workspaceId,
          docId,
          title,
          mode,
        });

        // ⚠️ **サーバーが採番した版数を、ここで必ず控える**（7.12）。
        //
        // 控えないと、直後の題の書き込みが baseRevision 0 で送られる。
        // サーバーは作成時に 1 から採番するため**必ず食い違い**、
        // stale と判定され、**打った題が捨てられる**（2026-08-31 実測）。
        //
        // ⚠️ **`revision`（単数）で代用しないこと。** 作成は3つ同時に
        // 採番する。⚠️ **「全部 1」と推測しないこと。** 作成は冪等な
        // upsert で、再送では既にある行の版数が返る。
        //
        // 後続の書き込みは `createGates` でこの関数の完了まで待つので、
        // ここで控えれば順序は構造的に保証される
        this.remember(docId, 'title', result.titleRevision);
        this.remember(docId, 'trash', result.trashRevision);
        this.remember(docId, 'tags', result.tagsRevision);

        if (owner) {
          await this.pending
            .remove({ workspaceId, userId: owner, docId, field: 'create' })
            .catch(() => undefined);
        }
      } catch (e) {
        // ⚠️ 控えは残す。オンラインに戻ったら送り直される（7.5.8）
        this.logger.warn(`台帳へページの作成を送れませんでした: ${docId}`, e);
      }
    });

    // ⚠️ **作成が終わるまで、そのページへの更新を送らせない。**
    // 先に題の変更が届くとサーバーは `not-found` を返し、その結果は
    // 「捨ててよい」に分類されるため**打った題が失われる**
    this.createGates.set(docId, done);
    void done.finally(() => {
      if (this.createGates.get(docId) === done) this.createGates.delete(docId);
    });
  }

  /**
   * ページの作成が終わるまで、その更新を待たせる門（#151 段階3）。
   *
   * ⚠️ 作成と更新は別の順番待ちに載る（フィールドごとに直列化するため）。
   * 門が無いと、**作りたてのページへの最初の変更が `not-found` で消える**。
   */
  private readonly createGates = new Map<string, Promise<void>>();

  /**
   * ページを消したことを台帳へ知らせる（#151 段階3）。
   *
   * ⚠️ **作成と同じ順番待ちに載せること。** 別の鍵にすると、
   * 作成より先に削除が届いて**消したはずのページが残る**。
   */
  deleted(workspaceId: string, docId: string): void {
    const owner = this.userId;
    void this.queues.add(`${workspaceId}:${docId}:create`, async () => {
      // ⚠️ **未送信の作成を先に捨てること。** 残すと、復帰時の再送で
      // `createDoc` が走り、**消したはずのページが台帳に復活する**
      if (owner) {
        await this.pending
          .remove({ workspaceId, userId: owner, docId, field: 'create' })
          .catch(() => undefined);
      }

      try {
        await this.store.deleteDoc({ workspaceId, docId });
      } catch (e) {
        this.logger.warn(`台帳へページの削除を送れませんでした: ${docId}`, e);
      }
    });
  }

  private async sendAll(
    workspaceId: string,
    docId: string,
    props: Partial<DocMeta>,
    before: DocMeta
  ): Promise<void> {
    // ⚠️ **何を送るかの判定は planMetaWrite が持つ。** ここに条件を書かない
    // （書き始めると、仕様が実装のあちこちに散る）
    const plans = planMetaWrite({
      props,
      before,
      revisions: this.revisions.get(docId) ?? MISSING_REVISIONS,
    });

    // ⚠️ **誰の変更かを、いま決めて持ち回る。** 順番待ちの間に利用者が
    // 変わり得るため、`this.userId` を送信時に読むと**別人の名義で送る**
    const owner = this.userId;

    for (const plan of plans) {
      // ⚠️ **フィールドごとの鍵で直列化する。** ドキュメント単位にすると、
      // 遅い題の送信がゴミ箱の送信を待たせる（フィールドどうしは独立）
      void this.queues.add(`${workspaceId}:${docId}:${plan.field}`, () =>
        this.sendOne(workspaceId, docId, plan, { owner })
      );
    }
  }

  /**
   * 1件送って、結果に応じた扱いをする。
   *
   * ⚠️ **「失敗」を1つにまとめないこと**（7.5.10）。判定は
   * `classifyWriteOutcome` が持ち、ここには条件を書かない。
   */
  private async sendOne(
    workspaceId: string,
    docId: string,
    plan: MetaWritePlan,
    options: {
      /**
       * **誰の変更か。** 積んだ時点の利用者を固定して持ち回る。
       *
       * ⚠️ **送信時に `this.userId` を読んではいけない。** 順番待ちの間に
       * サインアウトや利用者の切り替えが起き得るため、読むと
       * **旧利用者の変更を新利用者の名義で送る**ことになる。
       * 控えの削除も同じで、**新利用者の同じ鍵の控えを消してしまう**。
       */
      owner?: string;
      /**
       * 控えからの再送か。
       *
       * ⚠️ **再送では版数を取り直さない。** 取り直すと、オフライン中に
       * 他人が変えた分を黙って上書きする（`toWritePlan` に詳しく書いた）
       */
      resent?: boolean;
      /**
       * 再送のとき、**実際に送った控えの中身**。
       *
       * ⚠️ 受理されたあと控えを消してよいかの判定に使う。
       * 送信中に利用者が打ち進めていたら、消してはいけない
       */
      sent?: PendingWrite;
    }
  ): Promise<void> {
    const { owner, resent = false, sent } = options;
    const field = plan.field;

    // ⚠️ **作成が終わるまで待つ。** 先に届くと `not-found` になり、
    // その結果は「捨ててよい」に分類されて**変更が失われる**
    await this.createGates.get(docId)?.catch(() => undefined);

    // ⚠️ **送る直前に、利用者が変わっていないか確かめる。**
    // 変わっていたら送らない。控えたまま残すので、その利用者が
    // 戻ってきたときに改めて送られる（原則2）
    if (ownerChanged(owner, this.userId)) {
      await this.keepPending(workspaceId, docId, plan, owner);
      this.logger.warn(
        `利用者が変わったため送信を見送りました（控えたままです）: ${docId}.${field}`
      );
      return;
    }
    let result: DocMetaWriteResult | undefined;
    let error: unknown;

    try {
      // ⚠️ **送る直前に版数を取り直す。** 順番待ちの間に、自分の直前の
      // 変更が確定して版数が上がっていることがある。作った時点の版数で
      // 送ると**自分の直前の変更に負けて stale になり、捨てられる**
      result = await this.call(
        workspaceId,
        docId,
        resent ? plan : this.refresh(docId, plan)
      );
    } catch (e) {
      error = e;
    }

    const outcome = classifyWriteOutcome({ result, error });

    // ⚠️ 再送以外は控えを捨てる（7.5.10 の shouldDiscardPending）
    // ⚠️ 消すのは**送り主の**控え。`this.userId` で消すと、
    // 利用者が変わっていたときに**別人の控えを消す**
    if (shouldDiscardPending(outcome) && owner) {
      const target = { workspaceId, userId: owner, docId, field };

      if (sent) {
        // ⚠️ **送ったものと同じときだけ消す。** 送信中に打ち進めた分を
        // 消すと、その変更は送られないまま失われる（`samePending`）
        const now = await this.pending.get(target);
        if (now && samePending(now, sent)) await this.pending.remove(target);
      } else {
        await this.pending.remove(target);
      }
    }

    if (outcome === 'done') {
      this.remember(docId, field, result?.revision);
      return;
    }

    if (outcome === 'stale') {
      // ⚠️ **「取ってから捨てる」**（7.5.10 の7）。
      // 先に捨てると、送る当ての無い値がキャッシュに残る。
      // サーバーが返した現在値を控えてから、未送信分を捨てる
      this.remember(docId, field, result?.revision);
      this.onStale?.(docId, field, result);
      return;
    }

    if (outcome === 'forbidden') {
      // ⚠️ **利用者に伝える。** 操作が通らなかったのだから、
      // 黙って消してはいけない（原則2）
      // ⚠️ **戻してから伝える**（#182）。順序を逆にすると、利用者が
      // 通知を見て画面を確かめたときに、まだ拒否された値が出ている
      await this.revertToServer(workspaceId, docId, field, owner);
      this.onForbidden?.(docId, field);
      return;
    }

    if (outcome === 'not-found') {
      // 台帳に行が無い。次の取得で追いつく
      this.logger.warn(`台帳に行がありません: ${docId}`);
      return;
    }

    // retry: 送れなかったので控える（7.5.8）。
    // ⚠️ **捨てないこと。** 通信が切れただけで利用者の変更を失う。
    // ⚠️ ただし**再送の失敗では書き戻さない**。書き戻すと、送信中に
    // 利用者が打ち進めた新しい値を、古いスナップショットで巻き戻す
    // （`shouldKeepPending` に実地で見つけた例を書いた）
    if (shouldKeepPending(outcome, resent)) {
      await this.keepPending(workspaceId, docId, plan, owner);
    }
    this.logger.warn(
      `Discovery Metadata を送れませんでした（控えました）: ${docId}.${field}`,
      error
    );
  }

  /**
   * サーバーの現在値を手元へ取り込む（#182 / 突き合わせ）。
   *
   * ⚠️ **権限拒否では、サーバーが現在値を返さない。** stale は
   * `currentTitle` / `currentTrash` を返すが、拒否は GraphQL の例外として
   * 返るため中身が無い。台帳を取り直して当てる必要がある。
   *
   * ⚠️ **未送信の変更があるフィールドには当てない**（原則2）。
   * 当てると、利用者の変更が送られる前に消える。
   */
  private async revertToServer(
    workspaceId: string,
    docId: string,
    field: MetaWritePlan['field'],
    owner: string | undefined
  ): Promise<void> {
    if (!this.fetchServerMeta || !this.applyRemote) return;

    // ⚠️ **あとから積まれた変更があるなら戻さない。** 戻すと、そのあと
    // 送られる新しい値と画面が食い違ったままになる（送信は成功するのに
    // 画面は古い値）。次の契機で改めて揃う
    const queueKey = `${workspaceId}:${docId}:${field}`;
    if (this.queues.hasWaiting(queueKey)) return;

    let hasPending = false;
    if (owner) {
      const kept = await this.pending
        .get({ workspaceId, userId: owner, docId, field })
        .catch(() => undefined);
      hasPending = kept !== undefined;
    }

    const server = await this.fetchServerMeta(workspaceId, docId).catch(
      () => undefined
    );
    const patch = planReconcile({ field, server, hasPending });
    if (!patch) return;

    // ⚠️ **当てる直前にもう一度確かめる。** 台帳の取得は待ち時間が長く、
    // その間に利用者が同じフィールドを編集していることがある。
    // 取得前の一度きりの確認では、**取ってきた古い値で新しい入力を
    // 巻き戻す**（そのあと送信は成功するのに画面だけ古いまま残る）
    if (this.queues.hasWaiting(queueKey)) return;

    // ⚠️ **送り返さない経路で当てる。** `setDocMeta` を使うと送信を伴い、
    // サーバーから受け取った値をサーバーへ送り返す堂々巡りになる（原則5）
    this.applyRemote(docId, patch);
  }

  /**
   * 台帳から1件のメタを読む。**巻き戻しに使う。**
   *
   * 台帳の取得は一覧側が持っているため、そこから差し込む。
   */
  fetchServerMeta?: (
    workspaceId: string,
    docId: string
  ) => Promise<ServerDocMeta | undefined>;

  /** ⚠️ **送り返さない**経路で手元へ当てる（`applyRemoteDocMeta`）。 */
  applyRemote?: (docId: string, patch: ReconcilePatch) => void;

  /**
   * 控えてある変更をまとめて送り直す。
   *
   * ⚠️ **版数を取り込んだあとに呼ぶこと。** 版数を知らないまま送ると
   * 0 を基準にしてしまい、移行済みのページでは**必ず stale になって
   * 捨てられる**（7.5.10）。呼び出し側が台帳の決着後に呼ぶ。
   *
   * ⚠️ **待たない。** 契機は画面の描画経路にあるため、
   * ここで待つと一覧の表示が送信の完了に引きずられる。
   */
  resendPending(workspaceId: string): void {
    // ⚠️ **ワークスペース単位で直列化する。** 控えの一覧取得を挟むため、
    // 契機が近接すると（起動・オンライン復帰・台帳の決着）**両方が
    // 空の送信中集合を見て、同じ控えを2回送る**。2回送ると版数が
    // 無駄に上がり、全員のキャッシュが失効する
    void this.queues.add(`resend:${workspaceId}`, () =>
      this.resendAll(workspaceId)
    );
  }

  private async resendAll(workspaceId: string): Promise<void> {
    const userId = this.userId;
    // ⚠️ 誰の分か決まっていないなら送らない（共用 PC での誤送信を防ぐ）
    if (!userId) return;

    let entries;
    try {
      entries = await this.pending.list({ workspaceId, userId });
    } catch (e) {
      // ⚠️ 控えが読めなくても投げない。次の契機で取り直す
      this.logger.warn('控えを読めませんでした', e);
      return;
    }

    const keyOf = (entry: { docId: string; field: string }) =>
      `${workspaceId}:${entry.docId}:${entry.field}`;

    for (const entry of selectResendable(entries, this.resending, keyOf)) {
      const key = keyOf(entry);
      this.resending.add(key);

      void this.queues.add(key, async () => {
        try {
          const target = {
            workspaceId,
            userId,
            docId: entry.docId,
            field: entry.field,
          };
          // ⚠️ **送る直前に控えを読み直す。** 一覧を取ってから順番が
          // 回ってくるまでに、利用者が打ち進めていることがある。
          // 古いスナップショットを送って受理されると、
          // **新しい控えが消えて、その変更が失われる**
          const latest = await this.pending.get(target);
          // すでに送られて消えていた
          if (!latest) return;

          // ⚠️ 作成は値の変更ではないので、送り方が違う
          if (isCreate(latest)) {
            await this.store.createDoc({
              workspaceId,
              docId: entry.docId,
              title: latest.title,
              mode: latest.mode,
            });
            await this.pending.remove(target);
            return;
          }

          await this.sendOne(workspaceId, entry.docId, toWritePlan(latest), {
            // ⚠️ 一覧を取った時点の利用者。待っている間に変わったら
            // `sendOne` が送信を見送る
            owner: userId,
            resent: true,
            sent: latest,
          });
        } finally {
          // ⚠️ 成否によらず外す。外さないと、失敗したフィールドが
          // **二度と再送されなくなる**
          this.resending.delete(key);
        }
      });
    }
  }

  /**
   * いま再送中の控え。
   *
   * ⚠️ **同じ控えを二重に積まないため。** 契機は複数ある（起動・復帰・
   * 取り直し）ので、重なると同じ値を2回送って**版数が無駄に上がる**。
   */
  private readonly resending = new Set<string>();

  /**
   * 送れなかった変更を控える。
   *
   * ⚠️ **同じフィールドの控えがあれば1つにまとめる**（7.5.8）。
   * 値型は後勝ち、`tags` は操作を積み重ねる。判定は `mergePending` が持つ。
   */
  private async keepPending(
    workspaceId: string,
    docId: string,
    plan: MetaWritePlan,
    /** ⚠️ **送り主。** `this.userId` を読むと別人の控えとして保存する */
    owner: string | undefined
  ): Promise<void> {
    const userId = owner;
    // ⚠️ 誰の変更か決められないなら控えない（共用 PC で誤送信しない）
    if (!userId) return;

    const target = {
      workspaceId,
      userId,
      docId,
      field: plan.field,
    } as const;

    const entry = toPendingWrite(target, plan);
    const merged = mergePending(await this.pending.get(target), entry);

    // ⚠️ 打ち消し合って空になったら控えごと捨てる（送ると版数が無駄に上がる）
    if (isEmptyPending(merged)) {
      await this.pending.remove(target);
      return;
    }
    await this.pending.put(merged);
  }

  /**
   * 作ってから送るまでの間に上がった、**自分の**版数を取り込む。
   *
   * ⚠️ 取り込むのは `revisions`（自分の書き込みの結果とサーバーの応答）だけ。
   * 他人の変更を勝手に基準にはしない——それをすると CAS が意味を失い、
   * **他人の変更を黙って上書きする**。
   */
  private refresh(docId: string, plan: MetaWritePlan): MetaWritePlan {
    // タグは操作型で版数を見ない（7.5.10）
    if (plan.field === 'tags') return plan;

    const current = this.revisions.get(docId)?.[plan.field];
    if (current === undefined) return plan;

    return { ...plan, baseRevision: current };
  }

  private call(
    workspaceId: string,
    docId: string,
    plan: MetaWritePlan
  ): Promise<DocMetaWriteResult> {
    if (plan.field === 'title') {
      return this.store.setTitle({
        workspaceId,
        docId,
        title: plan.title,
        baseRevision: plan.baseRevision,
      });
    }
    if (plan.field === 'trash') {
      return this.store.setTrash({
        workspaceId,
        docId,
        trash: plan.trash,
        baseRevision: plan.baseRevision,
      });
    }
    return this.store.changeTags({
      workspaceId,
      docId,
      add: plan.add,
      remove: plan.remove,
    });
  }

  private remember(
    docId: string,
    field: keyof FieldRevisions,
    revision: string | undefined
  ): void {
    if (revision === undefined) return;
    const current = this.revisions.get(docId) ?? { ...MISSING_REVISIONS };
    this.revisions.set(docId, { ...current, [field]: revision });
  }
}

/** 送る予定を、控えの形にする。 */
function toPendingWrite(
  target: PendingTarget,
  plan: MetaWritePlan
): PendingWrite {
  if (plan.field === 'title') {
    return {
      ...target,
      field: 'title',
      title: plan.title,
      baseRevision: plan.baseRevision,
    };
  }
  if (plan.field === 'trash') {
    return {
      ...target,
      field: 'trash',
      trash: plan.trash,
      baseRevision: plan.baseRevision,
    };
  }
  return { ...target, field: 'tags', add: plan.add, remove: plan.remove };
}
