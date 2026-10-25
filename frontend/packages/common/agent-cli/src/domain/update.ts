import { createHash } from 'node:crypto';

import type { TableBlockModel } from '@blocksuite/affine/model';
import type { BlockModel, BlockSnapshot } from '@blocksuite/affine/store';

import { snapshotDelta } from '../convert/markdown';
import {
  IMAGE_FLAVOUR,
  imageLabel,
  NOTE_FLAVOUR,
  PLACEABLE_FLAVOURS,
  renderPage,
} from '../convert/render';
import type { DeltaOp } from '../convert/text-diff';
import { CliError } from '../errors';
import type { Op } from './ops';
import type { Page } from './page';

const TABLE_FLAVOUR = 'affine:table';
const VERSION_LENGTH = 12;

/** 最長共通部分列の表の大きさの上限（line-diff と同じ）。約 4,000,000 要素で数十 MB */
const MAX_LCS_CELLS = 4_000_000;

/**
 * Markdown からページ全体を更新する操作列を作る（設計書 §6.5）。
 *
 * ```
 * 今のページ  [見出し, 段落A, 段落B, 表]
 * Markdown    [見出し, 段落A', 新規, 段落B, 表']
 *               =      replace  insert  =   table.set
 * ```
 * 当てるのは edit と同じ Editor。ここは操作を組み立てるだけで Store を変えない。
 */
export async function planUpdate(page: Page, markdown: string): Promise<Op[]> {
  const snapshots = await page.codec.parse(markdown);
  if (snapshots.length === 0) {
    throw new CliError('Markdown が空', 'ページを空にするなら edit で消す');
  }

  const note = onlyNote(page);
  const ops: Op[] = [];
  await new Planner(page, ops).siblings(note.id, note.children, snapshots);
  return ops;
}

/** Markdown で表せないブロックを含むページは拒む（消すことになるため） */
export function assertUpdatable(page: Page): void {
  onlyNote(page);
}

/**
 * dry-run で見せた差分の印（`--base`）。題と全ブロックの ID・深さ・本文に、
 * 入力の Markdown と `--title` を加えて作る。
 *
 * ⚠️ 入力も含める。ページだけだと、dry-run の後に書き換えた Markdown を
 * 同じ base で送れてしまい、利用者が承認していない内容が届く。
 * ⚠️ Markdown に出ない属性（文字色等）だけの変更は検知しない。
 */
export async function updateBase(
  page: Page,
  markdown: string,
  title?: string
): Promise<string> {
  const rendered = await renderPage(page.docId, page.store, page.codec);
  const blocks = rendered.blocks.map(b => [b.id, b.depth, b.content]);
  return createHash('sha256')
    .update(JSON.stringify([rendered.title, blocks, markdown, title ?? null]))
    .digest('hex')
    .slice(0, VERSION_LENGTH);
}

function onlyNote(page: Page): BlockModel {
  const notes =
    page.store.root?.children.filter(c => c.flavour === NOTE_FLAVOUR) ?? [];
  if (notes.length !== 1) {
    throw new CliError(
      `note が ${notes.length} 個あるページは Markdown から更新できない`,
      'edit でブロック単位に直す'
    );
  }

  const locked = lockedIds(notes[0]);
  if (locked.length > 0) {
    throw new CliError(
      `編集できないブロックを含むため Markdown から更新できない: ${locked.join(' ')}`,
      'edit でブロック単位に直す'
    );
  }
  return notes[0];
}

/** 編集できないブロックの ID（子孫まで）。例: マルチカラム・画像・データベース */
function lockedIds(parent: BlockModel): string[] {
  return parent.children.flatMap(child =>
    PLACEABLE_FLAVOURS.has(child.flavour)
      ? lockedIds(child)
      : [child.id, ...lockedIds(child)]
  );
}

enum Kind {
  /** 本文が同じ。触らず、子の並びを比べる */
  Same,
  /** 同じ種類。replace で本文だけ変え、子の並びを比べる */
  Replace,
  /** 列数が同じ表。行とセルの差分 */
  Table,
  /** 種類が違う・列数が違う表。子ごと消して作る */
  Recreate,
  Delete,
  Insert,
}

/** 1つの兄弟の並びで、前から順に何をするか */
interface Step {
  kind: Kind;
  model?: BlockModel;
  oldKey?: string;
  /** 新しい並びでの位置（Delete 以外） */
  index?: number;
}

interface TableCells {
  columns: number;
  rows: string[][];
}

class Planner {
  private readonly tables = new Map<Step, [TableCells, TableCells]>();

  constructor(
    private readonly page: Page,
    private readonly ops: Op[]
  ) {}

  /** 兄弟の並び1つ分。残したブロックは子の並びにも繰り返す */
  async siblings(
    parentId: string,
    models: BlockModel[],
    snapshots: BlockSnapshot[]
  ): Promise<void> {
    const oldKeys = await Promise.all(models.map(m => this.key(m)));
    const newKeys = await Promise.all(snapshots.map(s => this.own(s)));
    const steps = await this.decide(models, oldKeys, snapshots, newKeys);

    // insert の位置に使う「新しい並びの各位置に残るブロック」
    const kept: Array<string | undefined> = snapshots.map(() => undefined);
    for (const step of steps) {
      if (step.index !== undefined && KEEPS.has(step.kind)) {
        kept[step.index] = step.model?.id;
      }
    }
    const anchor = (index: number) => kept.slice(index + 1).find(Boolean);

    for (const step of steps) {
      await this.emit(step, parentId, snapshots, newKeys, anchor);
    }
  }

  /** 一致したブロックの間（区間）を、前から1対1で組にする */
  private async decide(
    models: BlockModel[],
    oldKeys: string[],
    snapshots: BlockSnapshot[],
    newKeys: string[]
  ): Promise<Step[]> {
    const steps: Step[] = [];
    const ends: Array<[number, number]> = [
      ...commonPairs(oldKeys, newKeys),
      [models.length, snapshots.length],
    ];

    let i = 0;
    let j = 0;
    for (const [mi, mj] of ends) {
      for (; i < mi && j < mj; i++, j++) {
        steps.push(await this.pair(models[i], oldKeys[i], snapshots[j], j));
      }
      for (; i < mi; i++) {
        steps.push({ kind: Kind.Delete, model: models[i], oldKey: oldKeys[i] });
      }
      for (; j < mj; j++) {
        steps.push({ kind: Kind.Insert, index: j });
      }
      if (i < models.length) {
        steps.push({ kind: Kind.Same, model: models[i], index: j });
      }
      i++;
      j++;
    }
    return steps;
  }

  private async pair(
    model: BlockModel,
    oldKey: string,
    snapshot: BlockSnapshot,
    index: number
  ): Promise<Step> {
    const step: Step = { kind: Kind.Recreate, model, oldKey, index };
    // 画像は本文を持たない。鍵が違えば（一致しなかったので違う）作り直す
    if (model.flavour !== snapshot.flavour || model.flavour === IMAGE_FLAVOUR) {
      return step;
    }
    if (model.flavour !== TABLE_FLAVOUR) {
      return { ...step, kind: Kind.Replace };
    }

    const before = await this.tableCells((model as TableBlockModel).props);
    const after = await this.tableCells(
      snapshot.props as unknown as TableProps
    );
    if (before.columns !== after.columns) {
      return step;
    }
    const table = { ...step, kind: Kind.Table };
    this.tables.set(table, [before, after]);
    return table;
  }

  private async emit(
    step: Step,
    parentId: string,
    snapshots: BlockSnapshot[],
    newKeys: string[],
    anchor: (index: number) => string | undefined
  ): Promise<void> {
    const { model, oldKey, index } = step;
    const block = model?.id as string;
    const snapshot = snapshots[index as number];

    switch (step.kind) {
      case Kind.Same:
        return this.siblings(block, model!.children, snapshot.children);
      case Kind.Replace:
        this.ops.push({
          op: 'replace',
          block,
          expect: oldKey as string,
          content: newKeys[index as number],
        });
        return this.siblings(block, model!.children, snapshot.children);
      case Kind.Table:
        return this.tableOps(block, ...this.tables.get(step)!);
      case Kind.Delete:
        this.ops.push({
          op: 'delete',
          block,
          expect: expectOf(model!, oldKey),
        });
        return;
      case Kind.Recreate:
        this.ops.push({
          op: 'delete',
          block,
          expect: expectOf(model!, oldKey),
        });
        return this.insert(parentId, snapshot, anchor(index as number));
      case Kind.Insert:
        return this.insert(parentId, snapshot, anchor(index as number));
    }
  }

  /** 新しい並びで次に残るブロックの前。無ければ親の末尾 */
  private async insert(
    parentId: string,
    snapshot: BlockSnapshot,
    before: string | undefined
  ): Promise<void> {
    const position = before ? { before } : { parent: parentId };
    if (snapshot.flavour === IMAGE_FLAVOUR) {
      this.ops.push({
        op: 'image',
        file: this.imageRef(snapshot),
        ...position,
      });
      return;
    }
    const content = await this.page.codec.snapshotToMarkdown(snapshot);
    this.ops.push(
      before
        ? { op: 'insert', before, content }
        : { op: 'insert', parent: parentId, content }
    );
  }

  // ─── 表 ────────────────────────────────────────────────

  /**
   * 行を最長共通部分列で合わせ、変わったセルだけ table.set、増減は insertRow / deleteRow。
   * `at` は当てている途中の表での行の位置（前の操作で行がずれた後）。
   */
  private tableOps(block: string, before: TableCells, after: TableCells): void {
    // `at` を進めるのは、残る行（一致・書き換え）と足した行。消した行では進めない
    const join = (row: string[]) => JSON.stringify(row);
    const ends: Array<[number, number]> = [
      ...commonPairs(before.rows.map(join), after.rows.map(join)),
      [before.rows.length, after.rows.length],
    ];

    let at = 0;
    let i = 0;
    let j = 0;
    for (const [mi, mj] of ends) {
      for (; i < mi && j < mj; i++, j++, at++) {
        for (const [col, text] of after.rows[j].entries()) {
          const expect = before.rows[i][col];
          if (expect !== text) {
            this.ops.push({
              op: 'table.set',
              block,
              row: at,
              col,
              expect,
              text,
            });
          }
        }
      }
      for (; i < mi; i++) {
        this.ops.push({
          op: 'table.deleteRow',
          block,
          index: at,
          expect: before.rows[i],
        });
      }
      for (; j < mj; j++, at++) {
        this.ops.push({
          op: 'table.insertRow',
          block,
          at,
          cells: after.rows[j],
        });
      }
      i++;
      j++;
      at++;
    }
  }

  /** 表のセルを、読取表現と同じ並び（順序キーの文字コード順）の Markdown にする */
  private async tableCells(props: TableProps): Promise<TableCells> {
    const rows = Object.values(props.rows).sort(byOrder);
    const columns = Object.values(props.columns).sort(byOrder);
    const out: string[][] = [];
    for (const row of rows) {
      const cells: string[] = [];
      for (const col of columns) {
        const text = props.cells[`${row.rowId}:${col.columnId}`]?.text;
        cells.push(await this.page.codec.inlineToMarkdown(deltaOf(text)));
      }
      out.push(cells);
    }
    return { columns: columns.length, rows: out };
  }

  /** そのブロック自身の Markdown（子を除く）。今のページ側の key と揃える */
  private own(snapshot: BlockSnapshot): Promise<string> {
    if (snapshot.flavour === IMAGE_FLAVOUR) {
      return Promise.resolve(imageKey(snapshot.props.sourceId));
    }
    return this.page.codec.snapshotToMarkdown({ ...snapshot, children: [] });
  }

  /** 比べる鍵。画像は Markdown にならないので、中身の鍵で比べる（#278） */
  private key(model: BlockModel): Promise<string> {
    if (model.flavour === IMAGE_FLAVOUR) {
      return Promise.resolve(
        imageKey((model.props as { sourceId?: unknown }).sourceId)
      );
    }
    return this.page.codec.blockToMarkdown(model);
  }

  /** 新しい画像の、Markdown に書かれていたパス（image 操作の file にする） */
  private imageRef(snapshot: BlockSnapshot): string {
    const ref = this.page.codec.images?.refOf(String(snapshot.props.sourceId));
    if (!ref) {
      throw new CliError(
        '画像ファイルを読めない',
        'Markdown の画像のパスを確かめる'
      );
    }
    return ref;
  }
}

/** 画像の比べる鍵。Markdown の行と混ざらない形にする */
function imageKey(sourceId: unknown): string {
  return `\u0000image:${String(sourceId ?? '')}`;
}

/** delete の expect。画像は読取表現（`[image] キャプション`）と比べる */
function expectOf(model: BlockModel, key: string | undefined): string {
  return model.flavour === IMAGE_FLAVOUR ? imageLabel(model) : (key as string);
}

/** 今のブロックを残す（ID を保つ）扱い */
const KEEPS = new Set([Kind.Same, Kind.Replace, Kind.Table]);

type TableProps = TableBlockModel['props'];

function byOrder(a: { order: string }, b: { order: string }): number {
  if (a.order === b.order) {
    return 0;
  }
  return a.order > b.order ? 1 : -1;
}

/** Store の Text も、スナップショットの `{ delta }` も受ける */
function deltaOf(text: unknown): DeltaOp[] {
  if (!text) {
    return [];
  }
  if (typeof (text as { toDelta?: unknown }).toDelta === 'function') {
    return (text as { toDelta: () => DeltaOp[] }).toDelta();
  }
  return snapshotDelta({ props: { text } } as unknown as BlockSnapshot) ?? [];
}

/**
 * 最長共通部分列の組（添字）。例: `(['a','b','c'], ['a','c'])` → `[[0,0],[2,1]]`
 *
 * 表の大きさは (n+1)×(m+1)。1回の更新で変わるのは一部だけなので、
 * 一致する先頭・末尾を先に外して真ん中だけを比べる。
 */
function commonPairs(a: string[], b: string[]): Array<[number, number]> {
  const max = Math.min(a.length, b.length);
  let head = 0;
  while (head < max && a[head] === b[head]) {
    head++;
  }
  let tail = 0;
  while (
    tail < max - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const middle = middlePairs(
    a.slice(head, a.length - tail),
    b.slice(head, b.length - tail)
  ).map(([i, j]): [number, number] => [i + head, j + head]);
  const prefix = Array.from({ length: head }, (_, k): [number, number] => [
    k,
    k,
  ]);
  const suffix = Array.from({ length: tail }, (_, k): [number, number] => [
    a.length - tail + k,
    b.length - tail + k,
  ]);
  return [...prefix, ...middle, ...suffix];
}

function middlePairs(a: string[], b: string[]): Array<[number, number]> {
  if ((a.length + 1) * (b.length + 1) > MAX_LCS_CELLS) {
    throw new CliError(
      `変わったブロックが多すぎる（${a.length} → ${b.length}）`,
      'ページを分けるか、create で別のページとして作る'
    );
  }
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0)
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i++, j++]);
      continue;
    }
    if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      i++;
      continue;
    }
    j++;
  }
  return pairs;
}
