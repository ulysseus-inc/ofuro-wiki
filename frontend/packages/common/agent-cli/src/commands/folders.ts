import {
  type FolderNode,
  type FolderOutline,
  FolderTree,
} from '../domain/folders';
import type { LedgerDoc } from '../domain/ledger';
import type { Session } from '../domain/session';
import type { Space } from '../domain/space';
import { CliError } from '../errors';
import { type Args, flag, option, requirePositional } from './args';

const INDENT = '  ';

/**
 * `ofuro folders [--json]`。フォルダのツリー。
 *
 * ⚠️ 権限の無いページ・ゴミ箱のページは出さない（ブラウザも出さない）。
 */
export async function folders(session: Session, args: Args): Promise<string> {
  const spaces = await session.scope();
  const trees: Array<{ space: Space; roots: FolderOutline[] }> = [];
  for (const space of spaces) {
    const tree = await FolderTree.open(session, space);
    const docs = (await space.ledger.documents()).filter(d => !d.trash);
    const visible = new Map(docs.map(d => [d.id, d.title]));
    trees.push({ space, roots: tree.outline(visible) });
  }

  if (flag(args, 'json')) {
    await session.withNames(spaces);
    return JSON.stringify(
      trees.map(({ space, roots }) => ({
        workspace: { id: space.id, name: space.name },
        folders: roots,
      })),
      null,
      2
    );
  }

  const multiple = spaces.length > 1;
  if (multiple) {
    await session.withNames(spaces);
  }
  const lines = trees.flatMap(({ space, roots }) => [
    ...(multiple ? [`[${space.name}]`] : []),
    ...roots.flatMap(root => render(root, multiple ? 1 : 0)),
  ]);
  return lines.length > 0 ? lines.join('\n') : '（フォルダが無い）';
}

/**
 * `ofuro folder create <名前> [--parent <フォルダ>]`
 * `ofuro folder add <フォルダ> <docId>` / `ofuro folder remove <フォルダ> <docId>`
 */
export async function folder(session: Session, args: Args): Promise<string> {
  const action = requirePositional(args, 0, '操作（create / add / remove）');
  switch (action) {
    case 'create':
      return createFolder(session, args);
    case 'add':
      return moveDoc(session, args, Move.Add);
    case 'remove':
      return moveDoc(session, args, Move.Remove);
    default:
      throw new CliError(
        `不明な操作: ${action}`,
        'create / add / remove のどれか（ofuro help folder）'
      );
  }
}

async function createFolder(session: Session, args: Args): Promise<string> {
  const name = requirePositional(args, 1, 'フォルダの名前');
  const space = await session.createTarget();
  const tree = await FolderTree.open(session, space);
  const parentRef = option(args, 'parent');
  const parent = parentRef ? tree.resolve(parentRef) : null;

  const id = tree.createFolder(name, parent?.id ?? null);
  await tree.save(session, space);
  return `フォルダを作った: ${tree.path(id)}（${id}）`;
}

enum Move {
  Add,
  Remove,
}

async function moveDoc(
  session: Session,
  args: Args,
  move: Move
): Promise<string> {
  const folderRef = requirePositional(args, 1, 'フォルダ');
  const { space, docId } = await session.resolveDoc(
    requirePositional(args, 2, 'docId')
  );
  const doc = await space.ledger.find(docId);
  if (move === Move.Add && doc.trash) {
    throw new CliError(
      `ゴミ箱にあるページはフォルダに入れない: ${docId}`,
      `先に ofuro restore ${docId} で戻す`
    );
  }
  const tree = await FolderTree.open(session, space);
  const target = tree.resolve(folderRef);
  const where = tree.path(target.id);
  const title = doc.title || '無題';

  if (move === Move.Add) {
    if (!tree.addDoc(target.id, docId)) {
      return `既に入っている: ${where} ← ${title}`;
    }
    await tree.save(session, space);
    return `フォルダに入れた: ${where} ← ${title}`;
  }

  if (tree.removeDoc(target.id, docId) === 0) {
    return `このフォルダには無い: ${where} ← ${title}`;
  }
  await tree.save(session, space);
  return `フォルダから外した: ${where} ← ${title}（ページは消していない）`;
}

/** `create --folder` の行き先を先に確かめる（ページを作る前に打ち間違いで止める） */
export async function resolveFolders(
  session: Session,
  space: Space,
  refs: string[]
): Promise<{ tree: FolderTree; targets: FolderNode[] } | null> {
  if (refs.length === 0) {
    return null;
  }
  const tree = await FolderTree.open(session, space);
  return { tree, targets: refs.map(ref => tree.resolve(ref)) };
}

/** 作ったページをフォルダに入れる。出力の行を返す */
export async function placeInFolders(
  session: Session,
  space: Space,
  docId: string,
  plan: { tree: FolderTree; targets: FolderNode[] }
): Promise<string[]> {
  for (const target of plan.targets) {
    plan.tree.addDoc(target.id, docId);
  }
  await plan.tree.save(session, space);
  return plan.targets.map(t => `フォルダ: ${plan.tree.path(t.id)}`);
}

/**
 * `list --folder` の絞り込み。そのフォルダの直下のページだけ通す。
 * そのワークスペースに無ければ null（どこにも無ければ呼び出し側がエラーにする）
 */
export async function folderFilter(
  session: Session,
  space: Space,
  ref: string | undefined
): Promise<((doc: LedgerDoc) => boolean) | null> {
  if (ref === undefined) {
    return () => true;
  }
  const tree = await FolderTree.open(session, space);
  const target = tree.find(ref);
  if (!target) {
    return null;
  }
  const docIds = new Set(tree.docsIn(target.id));
  return doc => docIds.has(doc.id);
}

/**
 * 例:
 * ```
 * 設計（f1）
 *   下書き（f3）
 *   - 題B	docB
 * ```
 */
function render(node: FolderOutline, depth: number): string[] {
  const indent = INDENT.repeat(depth);
  return [
    `${indent}${node.name}（${node.id}）`,
    ...node.folders.flatMap(child => render(child, depth + 1)),
    ...node.pages.map(p => `${indent}${INDENT}- ${p.title}\t${p.docId}`),
  ];
}
