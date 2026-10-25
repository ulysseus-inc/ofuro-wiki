import type { Session } from '../domain/session';
import type { Space } from '../domain/space';

/** 例: `社内Wiki\t`。ワークスペースが1つなら空 */
export async function workspaceColumn(
  session: Session,
  spaces: Space[]
): Promise<(space: Space) => string> {
  if (spaces.length < 2) {
    return () => '';
  }
  await session.withNames(spaces);
  return space => `${space.name}\t`;
}
