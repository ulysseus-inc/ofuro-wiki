import { Store } from '@toeverything/infra';
import { map } from 'rxjs';

import type { Observable } from 'rxjs';

import { isEntryFor } from '../cache-identity';

import type { AsyncMemento } from '@toeverything/infra';

/**
 * #151: Discovery Index のローカルキャッシュ。
 *
 * > **⚠️ これは権限情報の正本ではない。認可済み Snapshot の一時的な複製である。**
 * > **権限の正本は常にサーバー側にあり、キャッシュの TTL によって**
 * > **権限失効を遅延させてはならない。**
 *
 * 将来「5分キャッシュすれば問い合わせを減らせる」という判断が出たとき、
 * **それがセキュリティ要件を壊す変更**だと分かるよう、ここに書いておく。
 *
 * | | 目的 |
 * |---|---|
 * | TTL | **性能・鮮度**のため |
 * | 権限失効 | **セキュリティ**のため |
 *
 * ## 目的
 *
 * 起動時・オフライン時の一覧表示を可能にする。**それだけ。**
 *
 * ## 保存してよいもの
 *
 * ⚠️ **本文・Yjs ドキュメント・エディタ状態を入れないこと。**
 * 「存在を知るための情報だけ」という約束が崩れる。
 *
 * 詳細は `docs/doc-permission.md`「Discovery Index Local Cache」。
 */
export class DiscoveryCacheStore extends Store {
  constructor(private readonly cache: AsyncMemento) {
    super();
  }

  /**
   * ⚠️ **鍵に `userId` を含める。**
   *
   * 含めないと、共用 PC で別の利用者が前の人の一覧を見る。
   * 「誰にとって認可された結果か」が鍵の一部である。
   */
  private key(workspaceId: string, userId: string): string {
    return `discovery:${workspaceId}:${userId}`;
  }

  async get(
    workspaceId: string,
    userId: string,
  ): Promise<DiscoveryCacheEntry | undefined> {
    const entry = await this.cache.get<DiscoveryCacheEntry>(
      this.key(workspaceId, userId),
    );
    if (!entry) return undefined;

    // ⚠️ 鍵が一致しても、中身が別人・別ワークスペースのものでないか確かめる。
    // 保存時の不具合や手動改変で入れ替わっていた場合に、
    // **他人の一覧を見せてしまう**ことを防ぐ
    if (!isEntryFor(entry, workspaceId, userId)) {
      await this.clear(workspaceId, userId);
      return undefined;
    }
    return entry;
  }

  async set(entry: DiscoveryCacheEntry): Promise<void> {
    await this.cache.set(this.key(entry.workspaceId, entry.userId), entry);
  }

  /** そのワークスペース・利用者の分を捨てる。 */
  async clear(workspaceId: string, userId: string): Promise<void> {
    await this.cache.del(this.key(workspaceId, userId));
  }

  /**
   * その利用者の分をすべて捨てる（**サインアウト時に呼ぶ**）。
   *
   * ⚠️ 鍵を `userId` で区切っても**データは端末に残る**。
   * 共用 PC で「A がサインアウト → B がサインイン」したとき、
   * A のタイトルがディスク上に残り続ける。
   */
  async clearUser(userId: string): Promise<void> {
    const keys = await this.cache.keys();
    await Promise.all(
      keys
        .filter((k: string) => k.startsWith('discovery:') && k.endsWith(`:${userId}`))
        .map((k: string) => this.cache.del(k)),
    );
  }

  /**
   * 変更を監視する。
   *
   * ⚠️ 同一タブだけでなく**別タブの変更も届く**
   * （`AsyncStorageMemento` が `BroadcastChannel` で伝播する）。
   * 仕様書が要件とする「複数タブへの invalidation の伝播」は、
   * この仕組みに乗ることで満たされる。
   */
  watch(workspaceId: string, userId: string): Observable<DiscoveryCacheEntry | undefined> {
    return this.cache.watch<DiscoveryCacheEntry>(this.key(workspaceId, userId)).pipe(
      // ⚠️ **`get()` と同じ本人確認を通すこと。** 別タブが書いた中身が
      // 別人・別ワークスペースのものだった場合に、**他人の一覧を
      // 取り込んでしまう**。鍵が合っていることは中身の保証にならない
      map(entry => (isEntryFor(entry, workspaceId, userId) ? entry : undefined)),
    );
  }
}

/**
 * 認可済み Snapshot の複製。
 *
 * ⚠️ **`userId` と `revision` を必ず持つこと。**
 * これが無いと「誰にとって・いつ時点で認可された結果か」を
 * ローカルで判定できず、キャッシュの正当性を確かめられない。
 */
export interface DiscoveryCacheEntry {
  workspaceId: string;
  /** ⚠️ 誰にとって認可された結果か */
  userId: string;
  /** ⚠️ サーバーのどの時点か。これが古ければ信用しない */
  revision: string;
  fetchedAt: string;
  documents: DiscoveryCacheDocument[];
}

/**
 * ⚠️ **本文を足さないこと。** Discovery Metadata だけを持つ。
 */
export interface DiscoveryCacheDocument {
  id: string;
  title: string | null;
  tagIds: string[];
  mode: string;
  /** ⚠️ ゴミ箱に入っているか。落とすと一覧に削除済みが出る */
  trash: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  /**
   * #151 段階3: フィールド単位の版数。
   *
   * ⚠️ **これが無いと書き込み時の `baseRevision` を決められず、
   * 移行済みのページへの変更が必ず stale になる**（7.5.10）。
   */
  titleRevision: string;
  trashRevision: string;
  tagsRevision: string;
}
