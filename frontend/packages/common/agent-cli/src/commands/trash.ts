import { TrashState } from '../domain/ledger';
import type { Session } from '../domain/session';
import { CliError } from '../errors';
import { type Args, flag, requirePositional } from './args';

/** `ofuro trash <docId>`。ブラウザの「ゴミ箱へ移動」と同じ */
export async function trash(session: Session, args: Args): Promise<string> {
  const { space, docId } = await session.resolveDoc(
    requirePositional(args, 0, 'docId')
  );
  const doc = await space.ledger.find(docId);
  if (doc.trash) {
    return `既にゴミ箱にある: ${doc.id}`;
  }
  await space.ledger.setTrash(doc, TrashState.Trashed);
  return `ゴミ箱へ移した: ${doc.id}（${doc.title || '無題'}）。戻すには ofuro restore ${doc.id}`;
}

/** `ofuro restore <docId>` */
export async function restore(session: Session, args: Args): Promise<string> {
  const { space, docId } = await session.resolveDoc(
    requirePositional(args, 0, 'docId')
  );
  const doc = await space.ledger.find(docId);
  if (!doc.trash) {
    return `ゴミ箱に無い: ${doc.id}`;
  }
  await space.ledger.setTrash(doc, TrashState.Restored);
  return `ゴミ箱から戻した: ${doc.id}（${doc.title || '無題'}）`;
}

/**
 * `ofuro purge <docId> --permanent`。取り消せない（設計書 §6.4）。
 *
 * ⚠️ サーバーはゴミ箱状態を見ずに消す。「ゴミ箱にあるものだけ」はここで守る。
 */
export async function purge(session: Session, args: Args): Promise<string> {
  const ref = requirePositional(args, 0, 'docId');
  if (!flag(args, 'permanent')) {
    throw new CliError(
      '完全削除には --permanent が要る',
      '取り消せない。利用者の承認を得てから --permanent を付けて再実行する'
    );
  }

  const { space, docId } = await session.resolveDoc(ref);
  const doc = await space.ledger.find(docId);
  if (!doc.trash) {
    throw new CliError(
      `ゴミ箱に無いページは完全削除できない: ${docId}`,
      `先に ofuro trash ${docId} でゴミ箱へ移す`
    );
  }
  await space.ledger.purge(docId);
  return `完全に削除した: ${docId}（${doc.title || '無題'}）`;
}
