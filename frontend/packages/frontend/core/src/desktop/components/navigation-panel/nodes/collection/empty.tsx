import { type DropTargetDropEvent, useDropTarget } from '@ofuro/component';
import type { AffineDNDData } from '@ofuro/core/types/dnd';
import { useI18n } from '@ofuro/i18n';

import { EmptyNodeChildren } from '../../layouts/empty-node-children';

export const Empty = ({
  onDrop,
}: {
  onDrop: (data: DropTargetDropEvent<AffineDNDData>) => void;
}) => {
  const { dropTargetRef } = useDropTarget(
    () => ({
      onDrop,
    }),
    [onDrop]
  );
  const t = useI18n();
  return (
    <EmptyNodeChildren ref={dropTargetRef}>
      {t['com.affine.collection.emptyCollection']()}
    </EmptyNodeChildren>
  );
};
