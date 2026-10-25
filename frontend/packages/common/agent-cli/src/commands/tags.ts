import type { LedgerDoc } from '../domain/ledger';
import type { Session } from '../domain/session';
import type { Space } from '../domain/space';
import { Missing, TagCatalog } from '../domain/tags';
import { CliError } from '../errors';
import { type Args, flag, options, requirePositional } from './args';
import { workspaceColumn } from './workspace-column';

/** `ofuro tags [--json]`。タグと、付いているページ数（ゴミ箱を除く） */
export async function tags(session: Session, args: Args): Promise<string> {
  const spaces = await session.scope();
  const rows: Array<{ space: Space; id: string; name: string; pages: number }> =
    [];
  for (const space of spaces) {
    const catalog = await TagCatalog.open(session, space);
    const docs = (await space.ledger.documents()).filter(d => !d.trash);
    for (const tag of catalog.list()) {
      const pages = docs.filter(d => d.tagIds.includes(tag.id)).length;
      rows.push({ space, id: tag.id, name: tag.name, pages });
    }
  }

  if (flag(args, 'json')) {
    await session.withNames(spaces);
    return JSON.stringify(
      rows.map(({ space, id, name, pages }) => ({
        id,
        name,
        pages,
        workspace: { id: space.id, name: space.name },
      })),
      null,
      2
    );
  }
  if (rows.length === 0) {
    return '（タグが無い）';
  }
  const prefix = await workspaceColumn(session, spaces);
  return rows
    .map(({ space, name, pages }) => `${prefix(space)}${name}\t${pages}`)
    .join('\n');
}

/** `ofuro tag <docId> [--add <名前>]... [--remove <名前>]...` */
export async function tag(session: Session, args: Args): Promise<string> {
  const { space, docId } = await session.resolveDoc(
    requirePositional(args, 0, 'docId')
  );
  const add = options(args, 'add');
  const remove = options(args, 'remove');
  if (add.length === 0 && remove.length === 0) {
    throw new CliError('--add か --remove が要る', 'ofuro help tag');
  }

  await space.ledger.find(docId);
  const catalog = await TagCatalog.open(session, space);
  // 外す側を先に確かめる。打ち間違いで止まるなら、タグを作る前に止める
  const removed = catalog.resolve(remove, Missing.Reject);
  const added = catalog.resolve(add, Missing.Create);
  await catalog.save(session, space);
  await space.ledger.changeTags(docId, added.ids, removed.ids);

  const now = await space.ledger.find(docId);
  return [
    `タグ: ${catalog.names(now.tagIds).join(', ') || '（なし）'}`,
    ...createdLines(added.created),
  ].join('\n');
}

/**
 * 作ったページにタグを付ける（`create --tag`）。
 *
 * 名前は先に `resolveTags` で確かめておき、ページを送った後に呼ぶ。
 */
export async function attachTags(
  session: Session,
  space: Space,
  docId: string,
  plan: TagPlan
): Promise<string[]> {
  if (plan.ids.length === 0) {
    return [];
  }
  await plan.catalog.save(session, space);
  await space.ledger.changeTags(docId, plan.ids, []);
  return [
    `タグ: ${plan.catalog.names(plan.ids).join(', ')}`,
    ...createdLines(plan.created),
  ];
}

export interface TagPlan {
  catalog: TagCatalog;
  ids: string[];
  created: Array<{ name: string }>;
}

/** `create --tag` の名前を ID に直す。無ければ手元で作る（送るのは attachTags） */
export async function resolveTags(
  session: Session,
  space: Space,
  refs: string[]
): Promise<TagPlan | null> {
  if (refs.length === 0) {
    return null;
  }
  const catalog = await TagCatalog.open(session, space);
  return { catalog, ...catalog.resolve(refs, Missing.Create) };
}

/**
 * `list --tag` / `search --tag` の絞り込み。指定したタグをすべて持つページだけ通す。
 *
 * そのワークスペースに無いタグがあれば、何も通さない（null）。
 * どのワークスペースにも無いなら呼び出し側がエラーにする。
 */
export async function tagFilter(
  session: Session,
  space: Space,
  refs: string[]
): Promise<((doc: LedgerDoc) => boolean) | null> {
  if (refs.length === 0) {
    return () => true;
  }
  const ids = (await TagCatalog.open(session, space)).lookup(refs);
  if (!ids) {
    return null;
  }
  return doc => ids.every(id => doc.tagIds.includes(id));
}

function createdLines(created: Array<{ name: string }>): string[] {
  return created.map(t => `新しいタグを作った: ${t.name}`);
}
