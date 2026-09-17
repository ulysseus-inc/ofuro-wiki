import type { MetaWritePlan } from './plan-meta-write';
import type { PendingWrite } from './stores/pending-write';

/**
 * #151 段階3: **控えておいた変更を、送る形に戻す。**
 *
 * ⚠️ **控えたときの `baseRevision` をそのまま使うこと。**
 *
 * 送る直前に版数を取り直す仕組み（`DocMetaWriteService.refresh`）は
 * **新しい変更のためのもの**で、再送に使ってはいけない。
 *
 * ```
 * 自分  オフラインで題を C にした（そのとき版数は 5）
 * 他人  その間に同じ題を D にした（サーバーの版数は 9 になった）
 *       ↓ 復帰して版数を取り直してから再送すると、基準が 9 になる
 * 結果  CAS が通ってしまい、**他人の変更 D を黙って上書きする**
 * ```
 *
 * 控えたときの 5 のまま送れば stale として弾かれ、突き合わせ（3c）へ回る。
 * **競合を検出できることこそが、版数を控えておく理由である。**
 *
 * ⚠️ `tags` は操作型なので版数を持たない（7.5.10）。足す・外すを
 * そのまま送る。他人が付けたタグは触らない。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.5.8 / 7.5.10
 */
export function toWritePlan(entry: PendingWrite): MetaWritePlan {
  // ⚠️ 作成は値の変更ではないので、書き込みの計画には写せない。
  // 呼び出し側が `isCreate` で先に分けること
  if (entry.field === 'create') {
    throw new Error('作成は toWritePlan では扱わない');
  }

  if (entry.field === 'title') {
    return {
      field: 'title',
      title: entry.title,
      // ⚠️ 控えたときの版数。取り直さない（上のとおり他人の変更を潰す）
      baseRevision: entry.baseRevision,
    };
  }

  if (entry.field === 'trash') {
    return {
      field: 'trash',
      trash: entry.trash,
      baseRevision: entry.baseRevision,
    };
  }

  return { field: 'tags', add: entry.add, remove: entry.remove };
}

/**
 * 再送してよい控えだけを選ぶ。
 *
 * ⚠️ **送るものが無い控えを送らないこと。** 打ち消し合って空になった
 * タグ操作を送ると、**版数が上がるだけで全員のキャッシュが失効する**。
 *
 * ⚠️ **すでに送信中のものを二重に送らないこと。** 同じ控えを2回積むと、
 * 1回目が受理されたあと2回目が走り、**版数が無駄に上がる**。
 * （複数タブでの重複送信はサーバー側の冪等性で吸収するが、
 * 同じタブの中で自分から重ねる必要はない・7.5.9 の4）
 */
export function selectResendable(
  entries: PendingWrite[],
  inFlight: ReadonlySet<string>,
  keyOf: (entry: PendingWrite) => string
): PendingWrite[] {
  return entries.filter(entry => {
    if (
      entry.field === 'tags' &&
      entry.add.length === 0 &&
      entry.remove.length === 0
    ) {
      return false;
    }
    return !inFlight.has(keyOf(entry));
  });
}

/**
 * 積んだときの送り主と、いまの利用者が食い違っているか。
 *
 * ⚠️ **送信の直前に確かめること。** 送信は順番待ちを挟むため、
 * その間にサインアウトや利用者の切り替えが起き得る。
 *
 * ```
 * 利用者A  題を変更（送信待ちに積まれる）
 *          ↓ 送信前にサインアウトし、利用者B がサインイン
 * 送信      this.userId を読むと B → **A の変更を B の名義で送る**
 * 控えの削除 B の同じ鍵の控えを消す → **B の未送信の変更が消える**
 * ```
 *
 * 食い違っていたら送らず、控えたまま残す。その利用者が戻ってきたときに
 * 改めて送られる（原則2: 未送信の変更を暗黙に破棄しない）。
 *
 * ⚠️ どちらも未設定（未サインイン）なら食い違いではない。
 */
export function ownerChanged(
  owner: string | undefined,
  current: string | undefined
): boolean {
  return owner !== current;
}

/**
 * 控えの中身が、送ったものと同じか。
 *
 * ⚠️ **受理されたからといって、控えを無条件に消してはいけない。**
 *
 * ```
 * 再送      控えを読んで "オフ" を送る
 * 利用者    送信中に打ち進めて、控えが "オフラインで変えた題" になる
 *           ↓ "オフ" が受理された
 * 無条件に消す → **打ち進めた分が、送られないまま消える**（原則2に反する）
 * ```
 *
 * 送ったものと同じときだけ消す。違っていれば、新しい控えとして残り、
 * 次の契機で送られる。
 */
export function samePending(a: PendingWrite, b: PendingWrite): boolean {
  if (a.field !== b.field) return false;

  if (a.field === 'title' && b.field === 'title') return a.title === b.title;
  if (a.field === 'trash' && b.field === 'trash') return a.trash === b.trash;
  if (a.field === 'tags' && b.field === 'tags') {
    return (
      sameSet(a.add, b.add) && sameSet(a.remove, b.remove)
    );
  }
  return false;
}

/** ⚠️ 順序は問わない。集合として同じかを見る */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every(v => set.has(v));
}

/** その控えがページの作成か（送り方が違う）。 */
export function isCreate(
  entry: PendingWrite
): entry is PendingWrite & { field: 'create'; title: string; mode: string } {
  return entry.field === 'create';
}
