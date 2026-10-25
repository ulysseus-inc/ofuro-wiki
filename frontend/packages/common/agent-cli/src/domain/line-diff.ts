/**
 * 行単位の差分（`edit --dry-run` の表示用）。
 *
 * 例: `["a","b"]` → `["a","c"]` は `["  a", "- b", "+ c"]`
 * 変わらない行は前後 CONTEXT 行だけ残し、間は `…` にする。
 */
const CONTEXT = 1;
const ELLIPSIS = '  …';

/** LCS 表の大きさの上限。超えたら真ん中を丸ごと消して足した扱いにする */
const MAX_LCS_CELLS = 4_000_000;

export function lineDiff(before: string[], after: string[]): string[] {
  // 1つの編集で変わるのは一部だけ。共通の先頭・末尾を先に外す
  const max = Math.min(before.length, after.length);
  let head = 0;
  while (head < max && before[head] === after[head]) {
    head++;
  }
  let tail = 0;
  while (
    tail < max - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }

  const middle = markLines(
    before.slice(head, before.length - tail),
    after.slice(head, after.length - tail)
  );
  const marked = [
    ...before.slice(0, head).map(line => `  ${line}`),
    ...middle,
    ...before.slice(before.length - tail).map(line => `  ${line}`),
  ];
  return collapse(marked);
}

/** 最長共通部分列で、残った行・消えた行・増えた行に分ける */
function markLines(before: string[], after: string[]): string[] {
  const n = before.length;
  const m = after.length;
  if ((n + 1) * (m + 1) > MAX_LCS_CELLS) {
    return [
      ...before.map(line => `- ${line}`),
      ...after.map(line => `+ ${line}`),
    ];
  }
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => 0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        before[i] === after[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push(`  ${before[i++]}`);
      j++;
      continue;
    }
    if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push(`- ${before[i++]}`);
      continue;
    }
    out.push(`+ ${after[j++]}`);
  }
  while (i < n) {
    out.push(`- ${before[i++]}`);
  }
  while (j < m) {
    out.push(`+ ${after[j++]}`);
  }
  return out;
}

function collapse(lines: string[]): string[] {
  const changed = lines.map(line => !line.startsWith('  '));
  const keep = lines.map((_, i) => {
    const from = Math.max(0, i - CONTEXT);
    const to = Math.min(lines.length - 1, i + CONTEXT);
    return changed.slice(from, to + 1).some(Boolean);
  });

  const out: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (keep[i]) {
      out.push(line);
      continue;
    }
    if (out.at(-1) !== ELLIPSIS) {
      out.push(ELLIPSIS);
    }
  }
  return out;
}
