import type {
  TableBlockModel,
  TableColumn,
  TableRow,
} from '@blocksuite/affine/model';
import { generateFractionalIndexingKeyBetween } from '@blocksuite/affine/shared/utils';
import { nanoid, Text } from '@blocksuite/affine/store';

import { isEditable } from '../convert/render';
import { applyTextDiff, type DeltaOp } from '../convert/text-diff';
import { CliError } from '../errors';
import type { TableDeleteOp, TableInsertOp, TableSetOp } from './ops';
import type { Page } from './page';

const TABLE_FLAVOUR = 'affine:table';

enum Axis {
  Row,
  Col,
}

type ExpectCheck = (id: string, expect: string, actual: string) => void;

/**
 * 表（`affine:table`）の操作。ブラウザの TableDataManager と同じ形でデータを触る。
 *
 * ```
 * rows:    { rowId: { rowId, order } }        order の昇順が上から下
 * columns: { columnId: { columnId, order } }  order の昇順が左から右
 * cells:   { "rowId:columnId": { text } }
 * ```
 * 行・列の番号は 0 始まりで、`ofuro read` に出る並び（見出し行が 0）。
 */
export class TableEditor {
  constructor(
    private readonly page: Page,
    private readonly checkExpect: ExpectCheck
  ) {}

  async set(op: TableSetOp): Promise<void> {
    const model = this.table(op.block);
    const row = pick(rowsOf(model), op.row, '行');
    const col = pick(columnsOf(model), op.col, '列');
    const text = cellText(model, row, col);

    const actual = await this.page.codec.inlineToMarkdown(
      text.toDelta() as DeltaOp[]
    );
    this.checkExpect(`${op.block}[${op.row},${op.col}]`, op.expect, actual);

    const delta = await this.page.codec.parseInline(op.text);
    this.page.store.transact(() => applyTextDiff(text, delta));
  }

  insertRow(op: TableInsertOp): Promise<void> {
    return this.insert(op, Axis.Row);
  }

  insertCol(op: TableInsertOp): Promise<void> {
    return this.insert(op, Axis.Col);
  }

  deleteRow(op: TableDeleteOp): Promise<void> {
    return this.remove(op, Axis.Row);
  }

  deleteCol(op: TableDeleteOp): Promise<void> {
    return this.remove(op, Axis.Col);
  }

  private async insert(op: TableInsertOp, axis: Axis): Promise<void> {
    const model = this.table(op.block);
    const lines = axis === Axis.Row ? rowsOf(model) : columnsOf(model);
    const others = axis === Axis.Row ? columnsOf(model) : rowsOf(model);
    const at = op.at ?? lines.length;
    if (at > lines.length) {
      throw new CliError(`位置が範囲外: ${at}（0〜${lines.length}）`);
    }
    if ((op.cells?.length ?? 0) > others.length) {
      throw new CliError(`cells が多すぎる（最大 ${others.length}）`);
    }

    // 書式を先に読んでおく（Store の変更をまとめて1回にするため）
    const deltas: DeltaOp[][] = [];
    for (const [i] of others.entries()) {
      deltas.push(await this.page.codec.parseInline(op.cells?.[i] ?? ''));
    }

    const order = generateFractionalIndexingKeyBetween(
      lines[at - 1]?.order ?? null,
      lines[at]?.order ?? null
    );
    const id = nanoid();
    const props = model.props;
    this.page.store.transact(() => {
      if (axis === Axis.Row) {
        props.rows[id] = { rowId: id, order };
      } else {
        props.columns[id] = { columnId: id, order };
      }
      others.forEach((other, i) => {
        const key =
          axis === Axis.Row ? `${id}:${idOf(other)}` : `${idOf(other)}:${id}`;
        props.cells[key] = { text: new Text(deltas[i]) };
      });
    });
  }

  private async remove(op: TableDeleteOp, axis: Axis): Promise<void> {
    const model = this.table(op.block);
    const lines: Array<TableRow | TableColumn> =
      axis === Axis.Row ? rowsOf(model) : columnsOf(model);
    const line = pick(lines, op.index, axis === Axis.Row ? '行' : '列');
    const id = idOf(line);

    if (op.expect) {
      const actual = await this.lineCells(model, axis, line);
      this.checkExpect(
        `${op.block}[${op.index}]`,
        op.expect.join(' | '),
        actual.join(' | ')
      );
    }

    const props = model.props;
    this.page.store.transact(() => {
      if (axis === Axis.Row) {
        delete props.rows[id];
      } else {
        delete props.columns[id];
      }
      for (const key of Object.keys(props.cells)) {
        const [rowId, columnId] = key.split(':');
        if ((axis === Axis.Row ? rowId : columnId) === id) {
          delete props.cells[key];
        }
      }
    });
  }

  /** その行（列）のセルを Markdown にして並べる */
  private async lineCells(
    model: TableBlockModel,
    axis: Axis,
    line: TableRow | TableColumn
  ): Promise<string[]> {
    const others = axis === Axis.Row ? columnsOf(model) : rowsOf(model);
    return Promise.all(
      others.map(other => {
        const [row, col] =
          axis === Axis.Row
            ? [line as TableRow, other as TableColumn]
            : [other as TableRow, line as TableColumn];
        return this.page.codec.inlineToMarkdown(
          cellText(model, row, col).toDelta() as DeltaOp[]
        );
      })
    );
  }

  private table(id: string): TableBlockModel {
    const model = this.page.store.getBlock(id)?.model;
    if (!model || model.flavour !== TABLE_FLAVOUR) {
      throw new CliError(
        `表ではない: ${id}`,
        'ofuro read で表のブロック ID を確かめる'
      );
    }
    if (!isEditable(model)) {
      throw new CliError(`この表は編集できない: ${id}`);
    }
    return model as TableBlockModel;
  }
}

function rowsOf(model: TableBlockModel): TableRow[] {
  return Object.values(model.props.rows).sort(byOrder);
}

function columnsOf(model: TableBlockModel): TableColumn[] {
  return Object.values(model.props.columns).sort(byOrder);
}

function byOrder(a: { order: string }, b: { order: string }): number {
  if (a.order === b.order) {
    return 0;
  }
  return a.order > b.order ? 1 : -1;
}

function idOf(line: TableRow | TableColumn): string {
  return 'rowId' in line ? line.rowId : line.columnId;
}

function pick<T>(list: T[], index: number, label: string): T {
  const item = list[index];
  if (!item) {
    throw new CliError(`${label}が範囲外: ${index}（0〜${list.length - 1}）`);
  }
  return item;
}

/** セルが欠けていたら作る（ブラウザも空セルとして扱う） */
function cellText(
  model: TableBlockModel,
  row: TableRow,
  col: TableColumn
): Text {
  const key = `${row.rowId}:${col.columnId}`;
  const cell = model.props.cells[key];
  if (cell) {
    return cell.text;
  }
  const text = new Text();
  model.props.cells[key] = { text };
  return model.props.cells[key].text;
}
