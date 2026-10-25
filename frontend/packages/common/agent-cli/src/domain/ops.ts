import { CliError } from '../errors';

/**
 * AI が渡す編集操作（設計書 §6.1）。
 *
 * 例:
 * ```json
 * [
 *   { "op": "replace", "block": "b2", "expect": "古い本文", "content": "新しい **本文**" },
 *   { "op": "insert", "after": "b2", "content": "- [ ] 追加の ToDo" }
 * ]
 * ```
 */
export type Op =
  | InsertOp
  | ReplaceOp
  | DeleteOp
  | MoveOp
  | TableSetOp
  | TableInsertOp
  | TableDeleteOp
  | TitleOp
  | ImageOp;

/** 位置の指定。`after` / `before` は兄弟、`parent` はその末尾。どれも無ければページ末尾 */
export interface Position {
  after?: string;
  before?: string;
  parent?: string;
}

export interface InsertOp extends Position {
  op: 'insert';
  content: string;
}

export interface ReplaceOp {
  op: 'replace';
  block: string;
  expect: string;
  content: string;
}

export interface DeleteOp {
  op: 'delete';
  block: string;
  expect: string;
}

export interface MoveOp extends Position {
  op: 'move';
  block: string;
}

export interface TableSetOp {
  op: 'table.set';
  block: string;
  row: number;
  col: number;
  expect: string;
  text: string;
}

/** `at` は新しい行（列）の位置。省略すると末尾。`cells` は初期値 */
export interface TableInsertOp {
  op: 'table.insertRow' | 'table.insertCol';
  block: string;
  at?: number;
  cells?: string[];
}

/** `expect` は消す行（列）のセルの並び。指定すると一致を確かめる */
export interface TableDeleteOp {
  op: 'table.deleteRow' | 'table.deleteCol';
  block: string;
  index: number;
  expect?: string[];
}

export interface TitleOp {
  op: 'title';
  text: string;
  expect?: string;
}

/** ローカルの画像を足す（#278）。`file` は相対パスならカレントディレクトリ基準 */
export interface ImageOp extends Position {
  op: 'image';
  file: string;
  caption?: string;
}

type Field = 'string' | 'number' | 'strings';

/** op ごとの必須・任意の引数 */
const SHAPES: Record<
  Op['op'],
  { required: Record<string, Field>; optional: Record<string, Field> }
> = {
  insert: {
    required: { content: 'string' },
    optional: { after: 'string', before: 'string', parent: 'string' },
  },
  replace: {
    required: { block: 'string', expect: 'string', content: 'string' },
    optional: {},
  },
  delete: { required: { block: 'string', expect: 'string' }, optional: {} },
  move: {
    required: { block: 'string' },
    optional: { after: 'string', before: 'string', parent: 'string' },
  },
  'table.set': {
    required: {
      block: 'string',
      row: 'number',
      col: 'number',
      expect: 'string',
      text: 'string',
    },
    optional: {},
  },
  'table.insertRow': {
    required: { block: 'string' },
    optional: { at: 'number', cells: 'strings' },
  },
  'table.insertCol': {
    required: { block: 'string' },
    optional: { at: 'number', cells: 'strings' },
  },
  'table.deleteRow': {
    required: { block: 'string', index: 'number' },
    optional: { expect: 'strings' },
  },
  'table.deleteCol': {
    required: { block: 'string', index: 'number' },
    optional: { expect: 'strings' },
  },
  title: { required: { text: 'string' }, optional: { expect: 'string' } },
  image: {
    required: { file: 'string' },
    optional: {
      caption: 'string',
      after: 'string',
      before: 'string',
      parent: 'string',
    },
  },
};

const POSITION_KEYS = ['after', 'before', 'parent'] as const;

/** JSON を読み、形を確かめる。1つでも不正なら何もしない */
export function parseOps(json: string): Op[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new CliError(
      '操作が JSON として読めない',
      'ofuro help format で書式を確かめる'
    );
  }

  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length === 0) {
    throw new CliError('操作が空', '1つ以上の操作を渡す');
  }
  return list.map((item, i) => validate(item, i));
}

function validate(item: unknown, index: number): Op {
  const where = `${index + 1} 番目の操作`;
  if (!item || typeof item !== 'object') {
    throw new CliError(`${where}がオブジェクトでない`);
  }

  const record = item as Record<string, unknown>;
  const name = record.op as Op['op'];
  const shape = SHAPES[name];
  if (!shape) {
    throw new CliError(
      `${where}の op が不明: ${String(record.op)}`,
      `使える op: ${Object.keys(SHAPES).join(' / ')}`
    );
  }

  for (const [key, field] of Object.entries(shape.required)) {
    if (!isField(record[key], field)) {
      throw new CliError(`${where}（${name}）の ${key} が無いか型が違う`);
    }
  }
  for (const [key, field] of Object.entries(shape.optional)) {
    if (record[key] !== undefined && !isField(record[key], field)) {
      throw new CliError(`${where}（${name}）の ${key} の型が違う`);
    }
  }

  const positions = POSITION_KEYS.filter(k => record[k] !== undefined);
  if (positions.length > 1) {
    throw new CliError(
      `${where}（${name}）に位置が複数ある: ${positions.join(', ')}`,
      'after / before / parent のどれか1つにする'
    );
  }
  return record as unknown as Op;
}

function isField(value: unknown, field: Field): boolean {
  if (field === 'strings') {
    return Array.isArray(value) && value.every(v => typeof v === 'string');
  }
  if (field === 'number') {
    return Number.isInteger(value) && (value as number) >= 0;
  }
  return typeof value === field;
}
