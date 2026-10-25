import type { BlockModel, BlockSnapshot } from '@blocksuite/affine/store';

import { strict } from '../convert/blocksuite';
import { snapshotDelta } from '../convert/markdown';
import {
  canHoldChildren,
  COLUMN_CELL_FLAVOUR,
  CONTAINER_FLAVOURS,
  hasLockedDescendant,
  IMAGE_FLAVOUR,
  imageLabel,
  isEditable,
  NOTE_FLAVOUR,
  pageTitle,
  PLACEABLE_FLAVOURS,
} from '../convert/render';
import { applyTextDiff } from '../convert/text-diff';
import { CliError } from '../errors';
import { nanoid } from '@blocksuite/affine/store';

import type {
  DeleteOp,
  ImageOp,
  InsertOp,
  MoveOp,
  Op,
  Position,
  ReplaceOp,
  TitleOp,
} from './ops';
import type { Page } from './page';
import { TableEditor } from './table';

const TABLE_FLAVOUR = 'affine:table';
const PARAGRAPH_FLAVOUR = 'affine:paragraph';
const LIST_FLAVOUR = 'affine:list';
const CODE_FLAVOUR = 'affine:code';
const TOGGLE = 'toggle';
const BULLETED = 'bulleted';

/** 何をしたか。AI に新しいブロック ID を知らせるために返す */
export interface EditResult {
  created: string[];
  /** 種類が変わって作り直したブロック。例: 段落 → 箇条書き */
  replaced: Array<{ from: string; to: string }>;
  /** 題を変えたときだけ。台帳へも送る必要がある */
  title?: string;
}

/**
 * 操作列を手元の Store に当てる。送信はしない（呼び出し側が push する）。
 *
 * ⚠️ 1つでも失敗したら例外で抜ける。手元の変更は送らずに捨てるため、
 * 編集全体が「全部当たるか、何も当たらないか」になる（設計書 §6.2）。
 */
export class Editor {
  private readonly table: TableEditor;
  private readonly result: EditResult = { created: [], replaced: [] };

  constructor(private readonly page: Page) {
    this.table = new TableEditor(page, (id, expect, actual) =>
      this.checkExpect(id, expect, actual)
    );
  }

  async apply(ops: Op[]): Promise<EditResult> {
    for (const [index, op] of ops.entries()) {
      try {
        await strict(() => this.applyOne(op));
      } catch (e) {
        if (e instanceof CliError) {
          throw new CliError(
            `${index + 1} 番目の操作（${op.op}）: ${e.message}`,
            e.hint
          );
        }
        throw e;
      }
    }
    return this.result;
  }

  private async applyOne(op: Op): Promise<void> {
    switch (op.op) {
      case 'insert':
        return this.insert(op);
      case 'replace':
        return this.replace(op);
      case 'delete':
        return this.remove(op);
      case 'move':
        return this.move(op);
      case 'table.set':
        return this.table.set(op);
      case 'table.insertRow':
        return this.table.insertRow(op);
      case 'table.insertCol':
        return this.table.insertCol(op);
      case 'table.deleteRow':
        return this.table.deleteRow(op);
      case 'table.deleteCol':
        return this.table.deleteCol(op);
      case 'title':
        return this.title(op);
      case 'image':
        return this.image(op);
    }
  }

  // ─── insert ───────────────────────────────────────────────

  private async insert(op: InsertOp): Promise<void> {
    const { parent, index } = this.resolvePosition(op);
    const snapshots = await this.page.codec.parse(op.content);
    if (snapshots.length === 0) {
      throw new CliError('content が空', '追加する本文を書く');
    }
    snapshots.forEach(assertCreatable);

    for (const [i, snapshot] of snapshots.entries()) {
      const id = await this.page.codec.insert(
        this.page.store,
        snapshot,
        parent.id,
        index + i
      );
      this.result.created.push(id);
    }
  }

  // ─── image（#278） ────────────────────────────────────────

  /** ローカルの画像を足す。送るのは呼び出し側（本文より先に） */
  private async image(op: ImageOp): Promise<void> {
    const images = this.page.codec.images;
    if (!images) {
      throw new CliError('画像を読み込めない（この操作では画像を足せない）');
    }
    const { parent, index } = this.resolvePosition(op);
    const { key } = images.add(op.file);
    const snapshot: BlockSnapshot = {
      type: 'block',
      id: nanoid(),
      flavour: IMAGE_FLAVOUR,
      props: { sourceId: key, ...(op.caption ? { caption: op.caption } : {}) },
      children: [],
    };
    const id = await this.page.codec.insert(
      this.page.store,
      snapshot,
      parent.id,
      index
    );
    this.result.created.push(id);
  }

  // ─── replace ──────────────────────────────────────────────

  private async replace(op: ReplaceOp): Promise<void> {
    const model = this.editableBlock(op.block);
    await this.checkBlockExpect(model, op.expect);
    if (model.flavour === IMAGE_FLAVOUR) {
      throw new CliError(
        '画像は replace で書き換えない',
        '差し替えは delete してから image で足す'
      );
    }
    if (model.flavour === TABLE_FLAVOUR) {
      throw new CliError(
        '表は replace で書き換えない',
        'table.set / table.insertRow 等を使う'
      );
    }

    const snapshot = await this.parseSingle(op.content);
    if (snapshot.flavour === model.flavour) {
      this.updateInPlace(model, snapshot);
      return;
    }
    await this.recreate(model, snapshot);
  }

  /** 同じ種類なら、ID・子・Markdown に無い属性を残したまま差分だけ当てる */
  private updateInPlace(model: BlockModel, snapshot: BlockSnapshot): void {
    const props = changedProps(model, snapshot);
    const store = this.page.store;
    store.transact(() => {
      if (Object.keys(props).length > 0) {
        store.updateBlock(model, props);
      }
      const delta = snapshotDelta(snapshot);
      const text = (
        model.props as { text?: Parameters<typeof applyTextDiff>[0] }
      ).text;
      if (delta && text) {
        applyTextDiff(text, delta);
      }
    });
  }

  /** 種類が変わるときは、同じ位置に作り直して子を移す */
  private async recreate(
    model: BlockModel,
    snapshot: BlockSnapshot
  ): Promise<void> {
    if (
      model.children.length > 0 &&
      !CONTAINER_FLAVOURS.has(snapshot.flavour)
    ) {
      throw new CliError(
        `子を持つブロックを ${snapshot.flavour} には変えられない`,
        '先に子を move で移す'
      );
    }

    const store = this.page.store;
    const parent = this.parentOf(model);
    const index = parent.children.indexOf(model);
    const id = await this.page.codec.insert(store, snapshot, parent.id, index);
    const created = store.getBlock(id)?.model;
    if (!created) {
      throw new CliError(`作り直したブロックが見つからない: ${id}`);
    }

    if (model.children.length > 0) {
      store.moveBlocks([...model.children], created);
    }
    store.deleteBlock(model);
    this.result.replaced.push({ from: model.id, to: id });
  }

  private async parseSingle(content: string): Promise<BlockSnapshot> {
    const snapshots = await this.page.codec.parse(content);
    if (snapshots.length !== 1) {
      throw new CliError(
        `content が ${snapshots.length} ブロックになる。replace は1ブロック分だけ書く`,
        '増やす分は insert を使う'
      );
    }
    const [snapshot] = snapshots;
    assertCreatable(snapshot);
    if (snapshot.children.length > 0) {
      throw new CliError(
        'replace の content に子を含めない',
        '子は insert の parent で足す'
      );
    }
    if (snapshot.flavour === TABLE_FLAVOUR) {
      throw new CliError('replace で表は作らない', 'insert で表を足す');
    }
    return snapshot;
  }

  // ─── delete / move ────────────────────────────────────────

  private async remove(op: DeleteOp): Promise<void> {
    const model = this.editableBlock(op.block);
    await this.checkBlockExpect(model, op.expect);
    if (hasLockedDescendant(model)) {
      throw new CliError('編集不可のブロックを子に含むため消せない');
    }
    const parent = model.parent;
    this.page.store.deleteBlock(model);
    this.keepCellEditable(parent);
  }

  /**
   * カラムのセルを空にしない（§6.10）。空のセルにはブラウザでカーソルを置けない
   * （ブラウザもカラムを作るとき、各セルに空の段落を入れる）
   */
  private keepCellEditable(cell: BlockModel | null): void {
    if (cell?.flavour === COLUMN_CELL_FLAVOUR && cell.children.length === 0) {
      this.page.store.addBlock(PARAGRAPH_FLAVOUR, {}, cell.id);
    }
  }

  private move(op: MoveOp): void {
    const model = this.editableBlock(op.block);
    if (hasLockedDescendant(model)) {
      throw new CliError('編集不可のブロックを子に含むため動かせない');
    }

    const { parent, index } = this.resolvePosition(op);
    if (parent === model || isAncestor(model, parent)) {
      throw new CliError('自分の中へは動かせない');
    }

    // 指定位置にある兄弟の手前へ入れる。位置が末尾なら最後の兄弟の後ろ
    const store = this.page.store;
    const from = model.parent;
    const target = parent.children[index];
    if (target === model) {
      return;
    }
    if (target) {
      store.moveBlocks([model], parent, target, true);
    } else {
      const last = parent.children.at(-1);
      if (last === model) {
        return;
      }
      store.moveBlocks([model], parent, last ?? null, false);
    }
    this.keepCellEditable(from);
  }

  // ─── title ────────────────────────────────────────────────

  private title(op: TitleOp): void {
    const store = this.page.store;
    const root = store.root;
    if (!root) {
      throw new CliError('ページのルートが無い');
    }
    if (op.expect !== undefined) {
      this.checkExpect('title', op.expect, pageTitle(store));
    }

    const text = (root.props as { title: Parameters<typeof applyTextDiff>[0] })
      .title;
    store.transact(() => applyTextDiff(text, [{ insert: op.text }]));
    this.result.title = op.text;
  }

  // ─── 共通 ─────────────────────────────────────────────────

  private block(id: string): BlockModel {
    const model = this.page.store.getBlock(id)?.model;
    if (!model) {
      throw new CliError(
        `ブロックが無い: ${id}`,
        'ofuro read で ID を確かめる'
      );
    }
    return model;
  }

  /** 編集不可ブロックへの操作は拒む（設計書 §6.3） */
  private editableBlock(id: string): BlockModel {
    const model = this.block(id);
    if (!PLACEABLE_FLAVOURS.has(model.flavour) || !isEditable(model)) {
      throw new CliError(
        `このブロックは編集できない: ${id}（${model.flavour}）`
      );
    }
    return model;
  }

  private parentOf(model: BlockModel): BlockModel {
    const parent = model.parent;
    if (!parent) {
      throw new CliError(`親が無い: ${model.id}`);
    }
    return parent;
  }

  /** 挿入先の親と、親の子の中での位置 */
  private resolvePosition(position: Position): {
    parent: BlockModel;
    index: number;
  } {
    if (position.after || position.before) {
      const sibling = this.block((position.after ?? position.before) as string);
      const parent = this.parentOf(sibling);
      this.assertContainer(parent);
      const index = parent.children.indexOf(sibling);
      return { parent, index: position.after ? index + 1 : index };
    }

    const parent = position.parent
      ? this.block(position.parent)
      : this.lastNote();
    this.assertContainer(parent);
    return { parent, index: parent.children.length };
  }

  private assertContainer(parent: BlockModel): void {
    if (!canHoldChildren(parent)) {
      throw new CliError(
        `ここには追加できない: ${parent.id}（${parent.flavour}）`,
        '編集可能な段落・箇条書き・note・カラムのセルの前後か中を指定する'
      );
    }
  }

  private lastNote(): BlockModel {
    const notes =
      this.page.store.root?.children.filter(c => c.flavour === NOTE_FLAVOUR) ??
      [];
    const note = notes.at(-1);
    if (!note) {
      throw new CliError(
        '本文を置く場所（note）が無い',
        'after / before / parent で位置を指定する'
      );
    }
    return note;
  }

  private async checkBlockExpect(
    model: BlockModel,
    expect: string
  ): Promise<void> {
    const actual =
      model.flavour === IMAGE_FLAVOUR
        ? imageLabel(model)
        : await this.page.codec.blockToMarkdown(model);
    this.checkExpect(model.id, expect, actual);
  }

  /**
   * AI が読んだ内容と今の内容を比べる。違えば編集全体を中止する（設計書 §6.2）。
   *
   * 空白・表の罫線の長さの違いは無視する（読み取り表現の字下げを写し損ねても通す）。
   */
  private checkExpect(id: string, expect: string, actual: string): void {
    if (expectMatches(expect, actual)) {
      return;
    }
    throw new CliError(
      `読んだ後に内容が変わっている: ${id}（今: ${JSON.stringify(actual)}）`,
      'ofuro read で読み直してから操作を作り直す'
    );
  }
}

/** Markdown のエスケープ。例: `EXTERNAL\\_MODE` の `\\_` */
const MARKDOWN_ESCAPE = /\\([!-/:-@[-`{-~])/g;

/** 表の罫線行。例: `| --- | :-: |` */
const TABLE_BORDER = /^\|?(\s*:?-+:?\s*\|)+\s*:?-*:?\s*$/;

/** 箇条書き・番号付き・ToDo の先頭の記号。例: `* [ ] `、`1. `、`- ` */
const LIST_MARKER = /^(?:[*+-]|\d+\.)\s+(?:\[[ xX]\]\s+)?/;

/**
 * expect が今の本文と一致するか。
 *
 * expect に記号が無ければ、今の本文の記号を外して比べる（#277）。
 * 記号を書いたなら記号も比べる。ToDo の完了など、同時に変えられた種類を見逃さないため。
 *
 * ⚠️ 引き換えに、記号を省いた expect は種類の変更を見逃す。例: 段落 `レビュー` を
 * 読んだ後に他人が箇条書き `* レビュー` に変えても通る。本文の同時変更は見逃さない。
 *
 * 例: `expectMatches('レビュー', '* [ ] レビュー')` → true
 *     `expectMatches('* [ ] レビュー', '* [x] レビュー')` → false
 */
export function expectMatches(expect: string, actual: string): boolean {
  const want = normalize(unifyBullet(expect));
  const have = normalize(unifyBullet(actual));
  if (want === have) {
    return true;
  }
  if (LIST_MARKER.test(want)) {
    return false;
  }
  return want === have.replace(LIST_MARKER, '');
}

/** 箇条書きの記号は `-` `+` `*` のどれでも同じ。例: `- 項目` → `* 項目` */
function unifyBullet(text: string): string {
  return text.trimStart().replace(/^[+-](\s)/, '*$1');
}

/**
 * expect の比較用に整える。
 *
 * 無視するのは、読取表現を写すときに崩れやすいものだけ:
 * 行頭・行末の空白、連続する空白、表の罫線の長さ、記号のエスケープ、前後の空行。
 * ⚠️ 本文中のハイフンや空行の違いは残す。消すと他人の変更を見逃す。
 */
export function normalize(text: string): string {
  return text.split('\n').map(normalizeLine).join('\n').trim();
}

function normalizeLine(raw: string): string {
  const line = raw.trim().replace(MARKDOWN_ESCAPE, '$1').replace(/\s+/g, ' ');
  return TABLE_BORDER.test(line) ? line.replace(/-+/g, '-') : line;
}

/** Markdown から作るのは編集可能な種類だけ。画像等は作らない（設計書 §6.3） */
function assertCreatable(snapshot: BlockSnapshot): void {
  // 画像はローカルのファイルから読んだものだけが来る（鍵の無いものは変換で拒む。§6.9）
  if (!PLACEABLE_FLAVOURS.has(snapshot.flavour)) {
    throw new CliError(
      `この種類は作れない: ${snapshot.flavour}`,
      '見出し・段落・箇条書き・ToDo・引用・コード・区切り線・表・ローカルの画像だけを書く'
    );
  }
  snapshot.children.forEach(assertCreatable);
}

/**
 * 種類（見出しの段・箇条書きの種類・ToDo の完了・コードの言語）の変更。
 *
 * ⚠️ トグルは Markdown で箇条書きになる。箇条書きのまま書き戻されたら
 * トグルを保つ（書き換えていないのに種類が変わるのを防ぐ）。
 */
function changedProps(
  model: BlockModel,
  snapshot: BlockSnapshot
): Record<string, unknown> {
  const current = model.props as Record<string, unknown>;
  const next = snapshot.props;
  const keys =
    model.flavour === CODE_FLAVOUR ? ['language'] : ['type', 'checked'];

  const changed: Record<string, unknown> = {};
  for (const key of keys) {
    if (next[key] === undefined || next[key] === current[key]) {
      continue;
    }
    changed[key] = next[key];
  }

  if (
    model.flavour === LIST_FLAVOUR &&
    current.type === TOGGLE &&
    changed.type === BULLETED
  ) {
    delete changed.type;
  }
  return changed;
}

function isAncestor(ancestor: BlockModel, model: BlockModel): boolean {
  let current = model.parent;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parent;
  }
  return false;
}
