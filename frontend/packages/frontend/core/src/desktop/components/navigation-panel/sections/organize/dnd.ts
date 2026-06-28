import type { DropTargetOptions } from '@ofuro/component';
import { isOrganizeSupportType } from '@ofuro/core/modules/organize/constants';
import type { AffineDNDData } from '@ofuro/core/types/dnd';

import type { NavigationPanelTreeNodeDropEffect } from '../../tree';

export const organizeChildrenDropEffect: NavigationPanelTreeNodeDropEffect =
  data => {
    if (
      data.treeInstruction?.type === 'reorder-above' ||
      data.treeInstruction?.type === 'reorder-below'
    ) {
      if (data.source.data.entity?.type === 'folder') {
        return 'move';
      }
    } else {
      return; // not supported
    }
    return;
  };

export const organizeEmptyDropEffect: NavigationPanelTreeNodeDropEffect =
  data => {
    const sourceType = data.source.data.entity?.type;
    if (sourceType && isOrganizeSupportType(sourceType)) {
      return 'link';
    }
    return;
  };

/**
 * Check whether the data can be dropped on the empty state of the organize section
 */
export const organizeEmptyRootCanDrop: DropTargetOptions<AffineDNDData>['canDrop'] =
  data => {
    const type = data.source.data.entity?.type;
    return !!type && isOrganizeSupportType(type);
  };
