import type { PendingWrite } from './stores/pending-write';

/**
 * #151 段階3: **同じフィールドへの未送信の変更を1つにまとめる。**
 *
 * オフライン中に何度も変更すると、控えが積み上がる。送るのは
 * **最後の1回で足りる**——ただし `tags` だけは違う。
 *
 * ## ⚠️ 値型（title / trash）は「後勝ち」でよい
 *
 * 「A → B → C」と変えたなら、送るのは C。途中の値をサーバーへ送っても
 * 意味が無い（版数が上がるだけで、全員のキャッシュが無駄に失効する）。
 *
 * ⚠️ ただし**基準の版数は最初の控えのものを使う**。
 * 途中の版数はサーバーへ届いていないので存在しない。
 * 同じ理由で「見ていた値」も最初のものを使う（移行判定に要る・7.7.4）。
 *
 * ## ⚠️ 操作型（tags）は積み重ねる
 *
 * 「z を足す」→「x を外す」と操作したなら、**両方**送る必要がある。
 * 後勝ちにすると、先の操作が消える（#164 と同じ形）。
 *
 * ⚠️ 打ち消し合う操作は相殺する。ただし**残すのはあとの操作**。
 * 「z を足す」→「z を外す」なら、残るのは**外す**であって、
 * 「どちらも送らない」ではない。未送信の `add` が届いていないからといって、
 * サーバーにそのタグが無いとは限らない（他人が付けていることがある）。
 * `remove` を落とすと**利用者の「外す」意図が消える**。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.5.8
 */
export function mergePending(
  previous: PendingWrite | undefined,
  next: PendingWrite
): PendingWrite {
  if (!previous) return next;

  // 別のフィールドが混ざることは無い（鍵がフィールドごとに分かれている）
  if (previous.field !== next.field) return next;

  if (next.field === 'tags' && previous.field === 'tags') {
    return {
      ...next,
      ...mergeTagOps(previous, next),
    };
  }

  if (next.field === 'title' && previous.field === 'title') {
    return {
      ...next,
      // ⚠️ 基準は最初の控えのもの。途中の版数はサーバーに存在しない
      baseRevision: previous.baseRevision,
    };
  }

  if (next.field === 'trash' && previous.field === 'trash') {
    return {
      ...next,
      baseRevision: previous.baseRevision,
    };
  }

  return next;
}

/**
 * タグの操作を積み重ねる。
 *
 * ⚠️ **打ち消し合う操作は相殺すること。** 「足して外した」を両方送ると、
 * サーバーで2回書き込みが起き、**版数が無駄に上がって全員のキャッシュが
 * 失効する**。相殺後に残すのは**あとの操作**（同じタグを両方に入れない）。
 */
export function mergeTagOps(
  previous: { add: string[]; remove: string[] },
  next: { add: string[]; remove: string[] }
): { add: string[]; remove: string[] } {
  const add = new Set(previous.add);
  const remove = new Set(previous.remove);

  for (const tag of next.add) {
    // あとから足したなら、前の「外す」は取り消される
    remove.delete(tag);
    add.add(tag);
  }
  for (const tag of next.remove) {
    // あとから外したなら、前の「足す」は取り消される
    add.delete(tag);
    remove.add(tag);
  }

  return { add: [...add], remove: [...remove] };
}

/** 送るものが無いか。**空なら控えごと捨てる。** */
export function isEmptyPending(entry: PendingWrite): boolean {
  return (
    entry.field === 'tags' && entry.add.length === 0 && entry.remove.length === 0
  );
}
