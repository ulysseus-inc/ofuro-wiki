/**
 * #151 段階3: **共有目次のその項目を消してよいか。**
 *
 * ⚠️ **規則をここ1か所に置く。** 点検（`IndexRemovalAuditService`）と
 * 掃除（`IndexPurgeService`）で別々に書いたところ、**食い違った**
 * （2026-08-27・実データで発覚）。
 *
 * ```
 * 点検側: 「食い違い」かつ版数 0 のときだけ危険
 * 掃除側: 版数 0 なら一律に残す
 *        ↓ doc-meta-sync は版数を上げずに写すため、既存はほぼ全部が版数 0
 * 結果   点検は「消して安全」と言うのに、掃除は 597 件中 595 件を消せない
 * ```
 *
 * ## 判定
 *
 * | 状態 | 消してよいか | 理由 |
 * |---|:---:|---|
 * | 台帳に行が無い | ❌ | **復元手段が無い** |
 * | 値が食い違い、そのフィールドの**版数が 0** | ❌ | 台帳が未所有＝**目次が正**（7.7.2） |
 * | 値が食い違うが**版数が 1 以上** | ✅ | 台帳が所有済み。目次が古いだけ |
 * | 値が一致 | ✅ | 消しても失うものが無い |
 *
 * ⚠️ **「版数が 1 以上であること」を条件にしないこと。**
 * `doc-meta-sync` は版数を上げずに値を写すため、**移行しただけのページは
 * すべて版数 0 のまま**である。条件にすると、**誰かが編集するまで
 * 永久に掃除できない**＝題が漏れ続ける。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.8
 */
export function judgeIndexEntry(
  page: IndexEntry,
  meta: LedgerEntry | undefined,
): EntryJudgement {
  if (!meta) {
    return { purgeable: false, reason: '台帳に行が無い' };
  }

  const risky: string[] = [];

  // ⚠️ 目次に題が無いときは同期が書かない。**書かない値を異常と呼ばない**
  const titleDiffers =
    page.title !== null && (meta.title ?? null) !== page.title;
  if (titleDiffers && meta.titleRevision === 0n) {
    risky.push('題');
  }

  if (meta.trash !== page.trash && meta.trashRevision === 0n) {
    risky.push('ゴミ箱');
  }

  if (!sameTags(meta.tagIds, page.tags) && meta.tagsRevision === 0n) {
    risky.push('タグ');
  }

  if (risky.length > 0) {
    return {
      purgeable: false,
      reason: `版数 0 で値が食い違う（目次が正）: ${risky.join('・')}`,
    };
  }

  return { purgeable: true };
}

/**
 * ⚠️ **並び順で比べないこと。** タグに順序の意味は無く、台帳（配列カラム）と
 * 目次（Y.Array）で並びが揃う保証も無い。順序で比べると、中身が同じでも
 * 「食い違い」と数えて**掃除に永久に進めなくなる**。
 */
export function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((t, i) => t === sortedB[i]);
}

export interface IndexEntry {
  id: string;
  title: string | null;
  tags: string[];
  trash: boolean;
}

export interface LedgerEntry {
  title: string | null;
  tagIds: string[];
  trash: boolean;
  titleRevision: bigint;
  trashRevision: bigint;
  tagsRevision: bigint;
}

export type EntryJudgement =
  | { purgeable: true; reason?: undefined }
  | { purgeable: false; reason: string };
