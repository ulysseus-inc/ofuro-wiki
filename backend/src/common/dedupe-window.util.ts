/**
 * #90: 「同じ事象を短時間に何度も記録しない」ための窓。
 *
 * 監査ログは3年保持するため、利用者が連打できる事象を1回ごとに記録すると
 * 一方的に膨らませられる。一方でまったく記録しないと #117 の検知材料が消える。
 * **粒度を落として両立させる**ためのもの。
 */
export interface DedupeWindow {
  /** 窓の中で既に記録済みなら true（呼び出し側は記録を省く）。 */
  shouldSkip(key: string): boolean;
  /** 保持しているキーの数（テスト用）。 */
  size(): number;
  /** 状態を消す（テスト用）。 */
  reset(): void;
}

export function createDedupeWindow(
  windowMs: number,
  maxEntries = 1000,
): DedupeWindow {
  const seen = new Map<string, number>();

  return {
    shouldSkip(key: string): boolean {
      const now = Date.now();
      const last = seen.get(key);
      if (last !== undefined && now - last < windowMs) return true;

      seen.set(key, now);

      if (seen.size > maxEntries) {
        // ⚠️ キーには利用者が指定できる値が入る。「期限切れだけ削除」にすると、
        // 窓の中で毎回違う値を送られた場合に1件も消えず、際限なく増える。
        for (const [k, t] of seen) {
          if (now - t >= windowMs) seen.delete(k);
        }
        // それでも超えるなら古い順に落とす。
        // 抑止が外れるだけで、記録が増える方向にしか働かないため安全側。
        while (seen.size > maxEntries) {
          const oldest = seen.keys().next();
          if (oldest.done) break;
          seen.delete(oldest.value);
        }
      }
      return false;
    },
    size: () => seen.size,
    reset: () => seen.clear(),
  };
}
