import type { Text } from '@blocksuite/affine/store';

/** 1文字分の挿入と属性。Y.Text の差分操作と同じ形 */
export interface DeltaOp {
  insert: string;
  attributes?: Record<string, unknown>;
}

/**
 * Markdown で表せる書式。これ以外（文字色・下線等）は表現に出ないため、
 * 変えていない文字の上では**触らずに残す**（設計書 G2）。
 */
const MARKDOWN_FORMATS = ['bold', 'italic', 'strike', 'code', 'link'] as const;

/** 1文字で1要素を表す埋め込み。文字が同じ空白でも別物として比べる */
const EMBED_KEYS = ['reference', 'latex', 'mention', 'footnote'];

interface Unit {
  ch: string;
  attrs: Record<string, unknown>;
  key: string;
}

/**
 * `text` を `next` に変える最小の差分を当てる（設計書 §6.2）。
 *
 * 全文を消して入れ直すと、他人が同時に打った文字と衝突し、書式も落ちる。
 * 先頭・末尾の一致部分は残し、変わった真ん中だけを消して入れる。
 *
 * 例: `abcXdef` → `abcYYdef` は「3文字目から1文字消して YY を入れる」だけ。
 */
export function applyTextDiff(text: Text, next: DeltaOp[]): void {
  const before = toUnits(text.toDelta() as DeltaOp[]);
  const after = toUnits(next);
  const { prefix, suffix } = commonEnds(before, after);

  // 真ん中を入れ替える
  const removed = before.length - prefix - suffix;
  if (removed > 0) {
    text.delete(prefix, removed);
  }
  // ⚠️ 属性を明示しないと Y.Text は隣の文字の書式（下線等）を引き継ぐ。
  // 書いた通りにするため、使われうる属性はすべて null で打ち消してから指定する
  const cleared = clearAll([...before, ...after]);
  let at = prefix;
  for (const run of toRuns(after.slice(prefix, after.length - suffix))) {
    text.insert(run.insert, at, { ...cleared, ...run.attributes });
    at += run.insert.length;
  }

  // 残した部分は、Markdown で表せる書式だけを合わせる
  formatRange(text, before, after, 0, 0, prefix);
  const tailBefore = before.length - suffix;
  const tailAfter = after.length - suffix;
  formatRange(text, before, after, tailBefore, tailAfter, suffix, at);
}

function toUnits(delta: DeltaOp[]): Unit[] {
  const units: Unit[] = [];
  for (const op of delta) {
    if (typeof op.insert !== 'string') {
      continue;
    }
    const attrs = op.attributes ?? {};
    const embed = embedKey(attrs);
    for (const ch of op.insert.split('')) {
      units.push({ ch, attrs, key: embed ? `${ch}${embed}` : ch });
    }
  }
  return units;
}

function embedKey(attrs: Record<string, unknown>): string {
  const parts = EMBED_KEYS.filter(k => attrs[k] !== undefined).map(
    k => `${k}=${JSON.stringify(canonical(attrs[k]))}`
  );
  return parts.join('&');
}

/**
 * 比較用に、未定義の値と空のオブジェクトを落とし、キーを並べ替える。
 *
 * 例: Markdown から読んだ参照は `params: { mode: undefined }` を持つが、
 * 元の参照は `params` を持たない。同じ参照として扱わないと、
 * 書き換えていない参照まで消して作り直してしまう。
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const entries = Object.entries(value)
    .map(([k, v]) => [k, canonical(v)] as const)
    .filter(([, v]) => v !== undefined && !isEmptyObject(v))
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

function isEmptyObject(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

/** サロゲートペアの途中では切らない */
function commonEnds(
  before: Unit[],
  after: Unit[]
): { prefix: number; suffix: number } {
  const max = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < max && before[prefix].key === after[prefix].key) {
    prefix++;
  }
  if (prefix > 0 && isHighSurrogate(before[prefix - 1].ch)) {
    prefix--;
  }

  let suffix = 0;
  while (
    suffix < max - prefix &&
    before[before.length - 1 - suffix].key ===
      after[after.length - 1 - suffix].key
  ) {
    suffix++;
  }
  if (suffix > 0 && isLowSurrogate(before[before.length - suffix].ch)) {
    suffix--;
  }
  return { prefix, suffix };
}

function isHighSurrogate(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0xdc00 && code <= 0xdfff;
}

/** 例: 下線と太字が使われていれば `{ underline: null, bold: null }` */
function clearAll(units: Unit[]): Record<string, null> {
  const keys = new Set(units.flatMap(u => Object.keys(u.attrs)));
  return Object.fromEntries([...keys].map(k => [k, null]));
}

/** 同じ属性が続く文字をまとめる */
function toRuns(units: Unit[]): DeltaOp[] {
  const runs: DeltaOp[] = [];
  for (const unit of units) {
    const last = runs.at(-1);
    if (last && sameAttrs(last.attributes ?? {}, unit.attrs)) {
      last.insert += unit.ch;
      continue;
    }
    runs.push(
      Object.keys(unit.attrs).length > 0
        ? { insert: unit.ch, attributes: unit.attrs }
        : { insert: unit.ch }
    );
  }
  return runs;
}

function sameAttrs(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(o).sort(([x], [y]) => x.localeCompare(y))
  );
}

/**
 * 一致部分の書式を合わせる。
 *
 * `textStart` は書き換え後の text 上の位置（末尾側は真ん中の長さで動くため別に持つ）。
 */
function formatRange(
  text: Text,
  before: Unit[],
  after: Unit[],
  beforeStart: number,
  afterStart: number,
  length: number,
  textStart = beforeStart
): void {
  for (const format of MARKDOWN_FORMATS) {
    let i = 0;
    while (i < length) {
      const want = after[afterStart + i].attrs[format];
      const have = before[beforeStart + i].attrs[format];
      if (isSame(want, have)) {
        i++;
        continue;
      }

      // 同じ値に変える文字をまとめて1回で書式を当てる
      let end = i + 1;
      while (
        end < length &&
        isSame(after[afterStart + end].attrs[format], want) &&
        !isSame(
          after[afterStart + end].attrs[format],
          before[beforeStart + end].attrs[format]
        )
      ) {
        end++;
      }
      text.format(textStart + i, end - i, { [format]: want ?? null });
      i = end;
    }
  }
}

function isSame(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}
