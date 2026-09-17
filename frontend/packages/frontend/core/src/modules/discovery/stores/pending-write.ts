import { Store } from '@toeverything/infra';

import type { AsyncMemento } from '@toeverything/infra';

import { pendingKey, selectPendingKeys } from '../pending-key';

/**
 * #151 段階3: **まだサーバーへ送れていない変更**を持っておく。
 *
 * ## ⚠️ なぜ自作するのか
 *
 * メタデータを Yjs から分離したことで、**Yjs の更新ログが提供していた
 * オフライン永続化・復帰機構を失った**（7.5.8）。今日オフライン中の
 * タグ・題・ゴミ箱の変更が復帰時に再生されるのは Yjs のおかげであり、
 * 自作コードは1行も書いていない。段階3 ではそれを自前で持つ。
 *
 * ## ⚠️ ドキュメント単位にしないこと
 *
 * 「ドキュメント A のメタ一式」として持つと、復帰時のマージで
 * **他人が変えた別フィールドを巻き戻す**。
 *
 * ```
 * 自分  オフラインで A のタグを変更（題は触っていない）
 * 他人  その間に A の題を変更
 *       ↓ 復帰してドキュメント単位でマージ
 * 結果  他人の題の変更が消える
 * ```
 *
 * これは #164（同時タグ編集で一方が消える）と同じ失敗を、
 * メタデータ層に持ち込む形である。**フィールド単位で持つ。**
 *
 * ## ⚠️ `tags` は「値」ではなく「操作」で持つ
 *
 * 「タグ = [x, z]」と持つと、オフライン中に他人が付けた `w` を
 * 復帰時に消す。**#164 そのもの。** add / remove を積む。
 *
 * ## ⚠️ 保存先はスナップショットと分けること
 *
 * 原則3（新しい Index を完全に取得・検証してから反映する）により
 * スナップショットは丸ごと入れ替わる。同じ鍵に同居させると、
 * **入れ替えのたびに未送信分が消える**。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.5.8 / 7.5.9
 */
export class PendingWriteStore extends Store {
  constructor(private readonly cache: AsyncMemento) {
    super();
  }

  /**
   * ⚠️ **鍵の分け方は仕様の中核**なので `pending-key.ts` に切り出し、
   * 単体で検査している（フィールド単位・利用者単位にする理由はそちら）。
   */
  private key(target: PendingTarget): string {
    return pendingKey(target);
  }

  /** 未送信の変更を控える。同じフィールドの古い控えは置き換える。 */
  async put(entry: PendingWrite): Promise<void> {
    await this.cache.set(this.key(entry), entry);
  }

  /** 送れたので控えを捨てる。 */
  async remove(target: PendingTarget): Promise<void> {
    await this.cache.del(this.key(target));
  }

  async get(target: PendingTarget): Promise<PendingWrite | undefined> {
    return this.cache.get<PendingWrite>(this.key(target));
  }

  /**
   * その利用者・ワークスペースの未送信分をすべて返す。
   *
   * ⚠️ **鍵の前方一致で拾う。** 一覧を別に持つと、書き込みと
   * 一覧の更新が2操作に分かれ、途中で落ちたときに食い違う。
   */
  async list(scope: {
    workspaceId: string;
    userId: string;
  }): Promise<PendingWrite[]> {
    const keys = selectPendingKeys(await this.cache.keys(), scope);

    const entries = await Promise.all(
      keys.map(k => this.cache.get<PendingWrite>(k))
    );
    // ⚠️ 鍵はあるが中身が無い場合を落とす（保存の途中で落ちた等）
    return entries.filter((e): e is PendingWrite => e !== undefined);
  }
}

/** どのワークスペースの・誰の・どのドキュメントの・どのフィールドか。 */
export interface PendingTarget {
  workspaceId: string;
  userId: string;
  docId: string;
  field: PendingField;
}

export type PendingField = 'title' | 'trash' | 'tags' | 'create';

/**
 * 未送信の変更。
 *
 * ⚠️ **値型と操作型で持ち方が違う**（7.5.8）。
 * - `title` / `trash` … 値と、基準にした版数
 * - `tags` … **add / remove の操作**（値で持つと #164 と同じ形で消える）
 */
export type PendingWrite = PendingTarget &
  (
    // ⚠️ 移行期間にあった `observedTitle` / `observedTrash` は撤去した
    // （2026-09-10・7.7.5）。**古い控えに残っていても余分な項目として
    // 無視される**ので、移行処理は要らない
    | { field: 'title'; title: string; baseRevision: string }
    | { field: 'trash'; trash: boolean; baseRevision: string }
    | { field: 'tags'; add: string[]; remove: string[] }
    /**
     * ページの作成。
     *
     * ⚠️ **これを控えないと、通信断のあいだに作ったページが失われる。**
     * 段階3 では目次にも書かないため、台帳に載らなければ
     * **再読み込みで一覧から消える**（本文だけが取り残される）。
     */
    | { field: 'create'; title: string; mode: string }
  );
