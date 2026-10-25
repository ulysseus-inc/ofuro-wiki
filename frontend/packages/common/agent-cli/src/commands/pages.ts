import fs from 'node:fs';
import path from 'node:path';

import { assetOf } from '../domain/assets';
import { Editor } from '../domain/editor';
import { lineDiff } from '../domain/line-diff';
import { type Op, parseOps } from '../domain/ops';
import {
  hasTitleHeading,
  Page,
  partialCreateError,
  splitTitle,
} from '../domain/page';
import { assertUpdatable, planUpdate, updateBase } from '../domain/update';
import type { LedgerDoc, SearchHit } from '../domain/ledger';
import type { Session } from '../domain/session';
import type { Space } from '../domain/space';
import { LocalImages } from '../convert/local-images';
import { formatPage, pageTitle } from '../convert/render';
import { TagCatalog } from '../domain/tags';
import { CliError } from '../errors';
import { type Args, flag, option, options, requirePositional } from './args';
import { folderFilter, placeInFolders, resolveFolders } from './folders';
import { attachTags, resolveTags, tagFilter } from './tags';
import { workspaceColumn } from './workspace-column';

const DEFAULT_SEARCH_LIMIT = 10;

/** `ofuro list [--json]`。ゴミ箱のページは出さない */
export async function list(session: Session, args: Args): Promise<string> {
  const spaces = await session.scope();
  const filters = await listFilters(session, spaces, args);
  const rows: Array<{ space: Space; doc: LedgerDoc }> = [];
  for (const space of spaces) {
    const matches = filters.get(space);
    if (!matches) {
      continue;
    }
    for (const doc of await space.ledger.documents()) {
      if (!doc.trash && matches(doc)) {
        rows.push({ space, doc });
      }
    }
  }

  if (flag(args, 'json')) {
    await session.withNames(spaces);
    const catalogs = new Map<Space, TagCatalog>();
    for (const space of new Set(rows.map(r => r.space))) {
      catalogs.set(space, await TagCatalog.open(session, space));
    }
    return JSON.stringify(
      rows.map(({ space, doc }) => ({
        docId: doc.id,
        title: doc.title,
        tags: catalogs.get(space)?.names(doc.tagIds) ?? [],
        updatedAt: doc.updatedAt,
        workspace: { id: space.id, name: space.name },
      })),
      null,
      2
    );
  }
  if (rows.length === 0) {
    return '（ページが無い）';
  }

  // ワークスペースが2つ以上なら、どこのページかを先頭に付ける
  const prefix = await workspaceColumn(session, spaces);
  return rows
    .map(
      ({ space, doc }) =>
        `${prefix(space)}${doc.id}\t${doc.updatedAt}\t${doc.title || '（無題）'}`
    )
    .join('\n');
}

/** `ofuro search <keyword> [--limit 10]` */
export async function search(session: Session, args: Args): Promise<string> {
  const keyword = requirePositional(args, 0, 'キーワード');
  const limit = Number(option(args, 'limit') ?? DEFAULT_SEARCH_LIMIT);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new CliError('--limit は正の整数');
  }

  const spaces = await session.scope();
  const filters = await tagFilters(session, spaces, options(args, 'tag'));
  const hits: Array<{ space: Space; hit: SearchHit }> = [];
  for (const space of spaces) {
    const matches = filters.get(space);
    if (!matches) {
      continue;
    }
    // ゴミ箱のページは出さない（list と揃える）
    const shown = new Set(
      (await space.ledger.documents())
        .filter(d => !d.trash && matches(d))
        .map(d => d.id)
    );
    for (const hit of await space.ledger.search(keyword, limit)) {
      if (shown.has(hit.docId)) {
        hits.push({ space, hit });
      }
    }
  }
  if (hits.length === 0) {
    return '（見つからない）';
  }

  const prefix = await workspaceColumn(session, spaces);
  return hits
    .slice(0, limit)
    .map(
      ({ space, hit }) =>
        `${prefix(space)}${hit.docId}\t${hit.title || '（無題）'}\t${oneLine(hit.highlight)}`
    )
    .join('\n');
}

/**
 * ワークスペースごとの `--tag` の絞り込み。そのワークスペースに無いタグがあれば入れない。
 * どのワークスペースにも無ければエラー（打ち間違いを「0件」で黙らせない）
 */
async function tagFilters(
  session: Session,
  spaces: Space[],
  refs: string[]
): Promise<Map<Space, DocFilter>> {
  return perSpace(
    spaces,
    space => tagFilter(session, space, refs),
    () =>
      new CliError(
        `タグが無い: ${refs.join(', ')}`,
        'ofuro tags で名前を確かめる'
      )
  );
}

type DocFilter = (doc: LedgerDoc) => boolean;

/** `list` の絞り込み（`--tag` と `--folder` の両方を満たすページ） */
async function listFilters(
  session: Session,
  spaces: Space[],
  args: Args
): Promise<Map<Space, DocFilter>> {
  const tags = await tagFilters(session, spaces, options(args, 'tag'));
  const ref = option(args, 'folder');
  const folders = await perSpace(
    spaces,
    space => folderFilter(session, space, ref),
    () =>
      new CliError(`フォルダが無い: ${ref}`, 'ofuro folders で名前を確かめる')
  );

  const both = new Map<Space, DocFilter>();
  for (const [space, byTag] of tags) {
    const byFolder = folders.get(space);
    if (byFolder) {
      both.set(space, doc => byTag(doc) && byFolder(doc));
    }
  }
  return both;
}

/**
 * ワークスペースごとの絞り込み。そのワークスペースに無い指定（null）なら入れない。
 * どのワークスペースにも無ければエラー（打ち間違いを「0件」で黙らせない）
 */
async function perSpace(
  spaces: Space[],
  make: (space: Space) => Promise<DocFilter | null>,
  missing: () => CliError
): Promise<Map<Space, DocFilter>> {
  const filters = new Map<Space, DocFilter>();
  for (const space of spaces) {
    const filter = await make(space);
    if (filter) {
      filters.set(space, filter);
    }
  }
  if (filters.size === 0) {
    throw missing();
  }
  return filters;
}

/** `ofuro read <docId | ページURL> [--json]` */
export async function read(session: Session, args: Args): Promise<string> {
  const { space, docId } = await session.resolveDoc(
    requirePositional(args, 0, 'docId')
  );
  const page = await Page.open(session, space, docId);
  const rendered = await page.render();
  const catalog = await TagCatalog.open(session, space);
  rendered.tags = catalog.names(page.ledgerDoc?.tagIds ?? []);
  if (flag(args, 'json')) {
    // 画像・添付には取り出しに使う情報を付ける（#273。ofuro image get）
    const blocks = rendered.blocks.map(block => {
      const model = page.store.getBlock(block.id)?.model;
      const asset = model ? assetOf(model) : undefined;
      return asset ? { ...block, asset } : block;
    });
    return JSON.stringify(
      { ...rendered, blocks, url: space.pageUrl(docId), workspaceId: space.id },
      null,
      2
    );
  }
  return formatPage(rendered, space.pageUrl(docId));
}

/**
 * `ofuro create --title <t> (--file <md> | --stdin)`
 *
 * 台帳への登録 → 本文の push の順（設計書 §7）。
 * 逆順だと、本文だけ残って誰の一覧にも出ないページができる。
 */
export async function create(session: Session, args: Args): Promise<string> {
  // 題と本文先頭の見出しが二重にならないよう分ける（#277）
  const { title, body: markdown } = splitTitle(
    readInput(args, 'file'),
    option(args, 'title')
  );

  const space = await session.createTarget();
  const docId = Page.newId();
  const page = await Page.build(
    space,
    docId,
    title,
    markdown,
    new LocalImages(inputDir(args))
  );
  // タグ・フォルダの名前は登録の前に確かめる（打ち間違いで止まるなら、ページを作る前に）
  const tags = await resolveTags(session, space, options(args, 'tag'));
  const places = await resolveFolders(session, space, options(args, 'folder'));
  // 画像は台帳・本文より先に送る（失敗したらページを作らない。§6.9）
  await page.uploadImages();
  await space.ledger.create(docId, title);
  try {
    await page.push(session);
  } catch (e) {
    throw partialCreateError(docId, e);
  }

  // ⚠️ フォルダはページを送った後に入れる。先に入れて失敗すると、無いページへのリンクが残る
  const lines = [`作成した: ${space.pageUrl(docId)}`, `docId: ${docId}`];
  if (tags) {
    lines.push(
      ...(await afterCreate(
        docId,
        'タグを付けられなかった',
        `ofuro tag ${docId} --add <名前>`,
        () => attachTags(session, space, docId, tags)
      ))
    );
  }
  if (places) {
    lines.push(
      ...(await afterCreate(
        docId,
        'フォルダに入れられなかった',
        `ofuro folder add <フォルダ> ${docId}`,
        () => placeInFolders(session, space, docId, places)
      ))
    );
  }
  return lines.join('\n');
}

/** 作成の後の仕上げ。失敗したら、ページはできていることと、やり直し方を示す */
async function afterCreate(
  docId: string,
  what: string,
  retry: string,
  run: () => Promise<string[]>
): Promise<string[]> {
  try {
    return await run();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new CliError(
      `ページは作ったが、${what}: ${docId}（${reason}）`,
      `${retry} でやり直す`
    );
  }
}

/** `ofuro edit <docId> (--ops <json> | --stdin) [--dry-run]` */
export async function edit(session: Session, args: Args): Promise<string> {
  const { space, docId } = await session.resolveDoc(
    requirePositional(args, 0, 'docId')
  );
  const ops = parseOps(readInput(args, 'ops', InputKind.Inline));

  // 開く＝最新を取り直す。expect はこの状態と比べる（設計書 §6.2）
  const page = await Page.open(session, space, docId);
  assertNotTrashed(page);
  page.codec.useImages(new LocalImages(process.cwd()));
  return send(session, page, ops, modeOf(args));
}

/**
 * `ofuro update <docId> (--file <md> | --stdin) [--title <t>] (--dry-run | --base <版>)`
 *
 * Markdown と今のページを比べて edit の操作列を作り、edit と同じ経路で当てる（設計書 §6.5）。
 * 同時編集は、dry-run で見せた版（--base）と開いた時点の版を比べて検知する。
 */
export async function update(session: Session, args: Args): Promise<string> {
  const mode = modeOf(args);
  const dryRun = mode === Mode.DryRun;
  const base = option(args, 'base');
  if (dryRun && base !== undefined) {
    throw new CliError(
      '--dry-run と --base は同時に使えない',
      '差分を見るなら --dry-run だけ、送るなら --base だけを付ける'
    );
  }
  if (!dryRun && base === undefined) {
    throw new CliError(
      '--base が無い',
      '先に --dry-run で差分を利用者に見せ、出た base を --base に付けて送る'
    );
  }

  const { space, docId } = await session.resolveDoc(
    requirePositional(args, 0, 'docId')
  );
  const input = readInput(args, 'file');
  const titleOption = option(args, 'title');

  const page = await Page.open(session, space, docId);
  assertNotTrashed(page);
  assertUpdatable(page);
  page.codec.useImages(new LocalImages(inputDir(args)));
  const version = await updateBase(page, input, titleOption);
  if (!dryRun && base !== version) {
    throw new CliError(
      `dry-run の後にページか Markdown が変わっている（base: ${base} → 今: ${version}）`,
      '--dry-run からやり直す'
    );
  }

  // 題は create と同じ決め方。先頭に # 見出しが無く --title も無ければ変えない
  const current = pageTitle(page.store);
  const { title, body } = splitTitle(
    input,
    titleOption ?? (hasTitleHeading(input) ? undefined : current)
  );
  const ops = await planUpdate(page, body);
  if (title !== current) {
    ops.unshift({ op: 'title', text: title, expect: current });
  }
  if (ops.length === 0) {
    return `変更なし\nbase: ${version}`;
  }

  const notes = [`操作: ${countOps(ops)}`];
  if (dryRun) {
    notes.push(`base: ${version}（送るときは --base ${version} を付ける）`);
  }
  return send(session, page, ops, mode, notes);
}

export enum Mode {
  DryRun,
  Send,
}

export function modeOf(args: Args): Mode {
  return flag(args, 'dry-run') ? Mode.DryRun : Mode.Send;
}

export function assertNotTrashed(page: Page): void {
  if (!page.ledgerDoc?.trash) {
    return;
  }
  throw new CliError(
    `ゴミ箱にあるページは編集できない: ${page.docId}`,
    `先に ofuro restore ${page.docId} で戻す`
  );
}

/** 例: `replace 2・insert 1・table.set 3` */
function countOps(ops: Op[]): string {
  const counts = new Map<string, number>();
  for (const { op } of ops) {
    counts.set(op, (counts.get(op) ?? 0) + 1);
  }
  return [...counts].map(([op, n]) => `${op} ${n}`).join('・');
}

/** 操作を当て、dry-run なら差分を、そうでなければ送った結果を返す */
export async function send(
  session: Session,
  page: Page,
  ops: Op[],
  mode: Mode,
  notes: string[] = []
): Promise<string> {
  const dryRun = mode === Mode.DryRun;
  const url = page.space.pageUrl(page.docId);
  const before = dryRun ? await page.format(url) : '';
  const result = await new Editor(page).apply(ops);
  const summary = [...notes, ...summarize(result)];
  const images = page.codec.images?.pending().length ?? 0;
  if (dryRun) {
    if (images > 0) {
      summary.push(`画像: ${images} 件（送るときにアップロードする）`);
    }
    const after = await page.format(url);
    return [
      '（dry-run: 送信していない）',
      ...summary,
      '',
      ...lineDiff(before.split('\n'), after.split('\n')),
    ].join('\n');
  }

  // ⚠️ 画像は本文より先に送る。失敗したら本文は送らない（§6.9）
  await page.uploadImages();

  // ⚠️ 題は台帳を先に変える。競合（stale）なら本文は送らずに止まる。
  // 本文を先に送ると、本文の題だけ変わって一覧の題と食い違ったまま残る
  const ledgerDoc = page.ledgerDoc;
  const titleChanged =
    result.title !== undefined && ledgerDoc && result.title !== ledgerDoc.title;
  if (titleChanged) {
    await page.space.ledger.setTitle(ledgerDoc, result.title as string);
  }
  const pushed = await page.push(session);
  if (!pushed && !titleChanged) {
    return '変更なし';
  }
  return [`更新した: ${url}`, ...summary].join('\n');
}

function summarize(result: Awaited<ReturnType<Editor['apply']>>): string[] {
  const lines: string[] = [];
  if (result.created.length > 0) {
    lines.push(`追加したブロック: ${result.created.join(' ')}`);
  }
  for (const { from, to } of result.replaced) {
    lines.push(`作り直したブロック: ${from} → ${to}`);
  }
  if (result.title !== undefined) {
    lines.push(`題: ${result.title}`);
  }
  return lines;
}

/** Markdown の画像の相対パスの基準。`--file` ならそのファイルの場所、それ以外はカレント */
function inputDir(args: Args): string {
  const file = option(args, 'file');
  return file ? path.dirname(path.resolve(file)) : process.cwd();
}

enum InputKind {
  File,
  Inline,
}

/** `--file <path>` / `--ops <json>` / `--stdin` のどれかから読む */
function readInput(args: Args, name: string, kind = InputKind.File): string {
  const value = option(args, name);
  const stdin = flag(args, 'stdin');
  if (value !== undefined && stdin) {
    throw new CliError(`--${name} と --stdin は同時に使えない`);
  }
  if (stdin) {
    return fs.readFileSync(0, 'utf8');
  }
  if (value === undefined) {
    throw new CliError(`--${name} か --stdin が要る`);
  }
  if (kind === InputKind.Inline) {
    return value;
  }
  try {
    return fs.readFileSync(value, 'utf8');
  } catch {
    throw new CliError(`ファイルを読めない: ${value}`);
  }
}

/** 抜粋は HTML（`<span class="keyword">語</span>`）。語を【】で囲んだ1行にする */
function oneLine(html: string): string {
  return html
    .replace(/<span class="keyword">(.*?)<\/span>/g, '【$1】')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
