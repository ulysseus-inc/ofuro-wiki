import {
  type DropTargetDropEvent,
  type DropTargetOptions,
  useDropTarget,
} from '@ofuro/component';
import type { AffineDNDData } from '@ofuro/core/types/dnd';
import { useI18n } from '@ofuro/i18n';

import { EmptyNodeChildren } from '../../layouts/empty-node-children';
import { draggedOverHighlight } from './empty.css';

export const FolderEmpty = ({
  canDrop,
  onDrop,
}: {
  onDrop?: (data: DropTargetDropEvent<AffineDNDData>) => void;
  canDrop?: DropTargetOptions<AffineDNDData>['canDrop'];
}) => {
  const { dropTargetRef } = useDropTarget(
    () => ({
      onDrop,
      canDrop,
    }),
    [onDrop, canDrop]
  );

  const t = useI18n();
  return (
    <EmptyNodeChildren ref={dropTargetRef} className={draggedOverHighlight}>
      {t['com.affine.rootAppSidebar.organize.empty-folder']()}
    </EmptyNodeChildren>
  );
};
