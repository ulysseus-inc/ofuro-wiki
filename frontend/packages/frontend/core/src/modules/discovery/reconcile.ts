import type { PendingField } from './stores/pending-write';

/**
 * #151 段階3: **サーバーの値を手元へ取り込んでよいか**（原則2 の具体化）。
 *
 * ```
 * fetch 結果を受け取る
 *   ↓
 * 未送信の変更が無いフィールド  → サーバーの値を採用
 * 未送信の変更があるフィールド  → 手元の値を維持（送信待ちのまま）
 *   ↓
 * サーバーが受理したら、そのフィールドの未送信分を破棄
 * ```
 *
 * **手元の変更をサーバーの上に積み直す。**
 *
 * ## ⚠️ なぜフィールド単位か
 *
 * ドキュメント単位で取り込むと、**他人が変えた別フィールドを巻き戻す**。
 * #164（同時タグ編集で一方が消える）と同じ失敗をメタデータ層に持ち込む形。
 *
 * ## ⚠️ 未送信の変更があるフィールドを上書きしてはいけない
 *
 * 上書きすると、**利用者の変更が送られる前に消える**。
 * 画面上は「入力したのに元に戻った」という形で現れ、原因が追いにくい。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.5.8 の「突き合わせの規則」
 */
export function planReconcile(input: {
  field: PendingField;
  /** サーバーの現在値（台帳） */
  server: ServerDocMeta | undefined;
  /** そのフィールドに未送信の変更があるか */
  hasPending: boolean;
}): ReconcilePatch | undefined {
  const { field, server, hasPending } = input;

  // ⚠️ 送信待ちの変更を、サーバーの値で潰さない（原則2）
  if (hasPending) return undefined;

  // 台帳に無い（消された・見えなくなった）。ここでは何もしない。
  // 一覧から消えるかどうかは一覧側の判断であって、メタの巻き戻しではない
  if (!server) return undefined;

  if (field === 'title') {
    return server.title === undefined ? undefined : { title: server.title };
  }

  if (field === 'trash') {
    return server.trash === undefined ? undefined : { trash: server.trash };
  }

  // ⚠️ タグは**配列をそのまま入れ替える**。ここはサーバーの値が正であり、
  // 未送信の変更が無いことは上で確かめてある。
  // （送信時に配列を送るのは #164 の再現になるが、**受け取り側は別**）
  return server.tagIds === undefined ? undefined : { tags: server.tagIds };
}

/** 台帳が返すメタのうち、突き合わせに関わる分だけ。 */
export interface ServerDocMeta {
  title?: string;
  trash?: boolean;
  tagIds?: string[];
}

/**
 * 手元へ当てる差分。
 *
 * ⚠️ **`setDocMeta` で当ててはいけない。** 送信を伴うため、サーバーから
 * 受け取った値をサーバーへ送り返す堂々巡りになる（7.5.9 の原則5）。
 * 送り返さない経路（`applyRemoteDocMeta`）を使う。
 */
export type ReconcilePatch =
  | { title: string }
  | { trash: boolean }
  | { tags: string[] };

/**
 * #151 段階3: **台帳の取り込みが、手元の新しい値を潰さないようにする。**
 *
 * ⚠️ **実測で見つかった不具合**（2026-08-25）。題を打った直後にゴミ箱へ
 * 入れると、ゴミ箱の一覧に「無題」と出た。台帳には正しい題が入っていた。
 *
 * ```
 * 利用者  題を打つ → キャッシュに反映（write-through）→ サーバーへ送信
 *         ↓ 送信が終わる前に台帳を取り直す
 * 取り込み 台帳の題はまだ空 → キャッシュを空で総入れ替え
 * 結果    打った題が画面から消える。しかもサーバーには入っている
 * ```
 *
 * ⚠️ **版数で判断する。** 手元が知っている版数のほうが新しければ、
 * その項目は手元の値を残す。「手元が知っている版数」は、
 * 自分の書き込みが成功したときにサーバーが返したもの。
 *
 * ⚠️ 目次が動かなくなった段階3 では取り直しの契機が減るため、
 * **一度潰すと長く戻らない**。段階2 までは目次の変化で頻繁に
 * 取り直していたので目立たなかった。
 */
export function keepNewerLocal(
  incoming: LedgerMeta,
  local: LocalMeta | undefined,
  known: FieldRevisions | undefined
): LedgerMeta['meta'] {
  if (!local || !known) return incoming.meta;

  const newer = (field: 'title' | 'trash' | 'tags') =>
    toNumber(known[field]) > toNumber(incoming.revisions[field]);

  return {
    ...incoming.meta,
    title: newer('title') ? local.title : incoming.meta.title,
    trash: newer('trash') ? local.trash : incoming.meta.trash,
    tags: newer('tags') ? local.tags : incoming.meta.tags,
  };
}

/** ⚠️ 版数は文字列で運ぶ（BigInt を GraphQL に載せられない）。比較は数値で */
function toNumber(v: string | undefined): number {
  const n = Number(v ?? '0');
  return Number.isFinite(n) ? n : 0;
}

export interface FieldRevisions {
  title: string;
  trash: string;
  tags: string;
}

export interface LocalMeta {
  title?: string;
  trash?: boolean;
  tags?: string[];
}

export interface LedgerMeta {
  meta: { id: string; title?: string; trash?: boolean; tags?: string[] };
  revisions: FieldRevisions;
}
