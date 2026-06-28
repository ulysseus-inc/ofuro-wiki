import {
  type DropTargetDropEvent,
  Skeleton,
  useDropTarget,
} from '@ofuro/component';
import type { AffineDNDData } from '@ofuro/core/types/dnd';
import { useI18n } from '@ofuro/i18n';
import { FavoriteIcon } from '@blocksuite/icons/rc';

import { NavigationPanelEmptySection } from '../../layouts/empty-section';
import { DropEffect } from '../../tree';
import { favoriteRootCanDrop, favoriteRootDropEffect } from './dnd';

interface RootEmptyProps {
  onDrop?: (data: DropTargetDropEvent<AffineDNDData>) => void;
  isLoading?: boolean;
}

const RootEmptyLoading = () => {
  return <Skeleton />;
};
const RootEmptyReady = ({ onDrop }: Omit<RootEmptyProps, 'isLoading'>) => {
  const t = useI18n();

  const { dropTargetRef, draggedOverDraggable, draggedOverPosition } =
    useDropTarget<AffineDNDData>(
      () => ({
        data: {
          at: 'navigation-panel:favorite:root',
        },
        onDrop: onDrop,
        canDrop: favoriteRootCanDrop,
        allowExternal: true,
      }),
      [onDrop]
    );

  return (
    <NavigationPanelEmptySection
      ref={dropTargetRef}
      icon={FavoriteIcon}
      message={t['com.affine.rootAppSidebar.favorites.empty']()}
      messageTestId="slider-bar-favorites-empty-message"
    >
      {draggedOverDraggable && (
        <DropEffect
          position={draggedOverPosition}
          dropEffect={favoriteRootDropEffect({
            source: draggedOverDraggable,
            treeInstruction: null,
          })}
        />
      )}
    </NavigationPanelEmptySection>
  );
};

export const RootEmpty = ({ isLoading, ...props }: RootEmptyProps) => {
  return isLoading ? <RootEmptyLoading /> : <RootEmptyReady {...props} />;
};
