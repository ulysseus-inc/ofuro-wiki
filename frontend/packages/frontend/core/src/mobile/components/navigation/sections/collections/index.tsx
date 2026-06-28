import { usePromptModal } from '@ofuro/component';
import { NavigationPanelTreeRoot } from '@ofuro/core/desktop/components/navigation-panel';
import { CollectionService } from '@ofuro/core/modules/collection';
import { NavigationPanelService } from '@ofuro/core/modules/navigation-panel';
import { WorkbenchService } from '@ofuro/core/modules/workbench';
import { useI18n } from '@ofuro/i18n';
import { track } from '@ofuro/track';
import { AddCollectionIcon } from '@blocksuite/icons/rc';
import { useLiveData, useServices } from '@toeverything/infra';
import { useCallback, useMemo } from 'react';

import { AddItemPlaceholder } from '../../layouts/add-item-placeholder';
import { CollapsibleSection } from '../../layouts/collapsible-section';
import { NavigationPanelCollectionNode } from '../../nodes/collection';
import * as styles from './index.css';

export const NavigationPanelCollections = () => {
  const t = useI18n();
  const { collectionService, workbenchService, navigationPanelService } =
    useServices({
      CollectionService,
      WorkbenchService,
      NavigationPanelService,
    });
  const path = useMemo(() => ['collections'], []);
  const collectionMetas = useLiveData(collectionService.collectionMetas$);
  const { openPromptModal } = usePromptModal();

  const handleCreateCollection = useCallback(() => {
    openPromptModal({
      title: t['com.affine.editCollection.saveCollection'](),
      label: t['com.affine.editCollectionName.name'](),
      inputOptions: {
        placeholder: t['com.affine.editCollectionName.name.placeholder'](),
      },
      children: (
        <div className={styles.createTips}>
          {t['com.affine.editCollectionName.createTips']()}
        </div>
      ),
      confirmText: t['com.affine.editCollection.save'](),
      cancelText: t['com.affine.editCollection.button.cancel'](),
      confirmButtonOptions: {
        variant: 'primary',
      },
      onConfirm(name) {
        const id = collectionService.createCollection({ name });
        track.$.navigationPanel.organize.createOrganizeItem({
          type: 'collection',
        });
        workbenchService.workbench.openCollection(id);
        navigationPanelService.setCollapsed(path, false);
      },
    });
  }, [
    collectionService,
    navigationPanelService,
    path,
    openPromptModal,
    t,
    workbenchService.workbench,
  ]);

  return (
    <CollapsibleSection
      path={path}
      testId="navigation-panel-collections"
      title={t['com.affine.rootAppSidebar.collections']()}
    >
      <NavigationPanelTreeRoot>
        {collectionMetas.map(collection => (
          <NavigationPanelCollectionNode
            key={collection.id}
            collectionId={collection.id}
            parentPath={path}
          />
        ))}
        <AddItemPlaceholder
          icon={<AddCollectionIcon />}
          data-testid="navigation-panel-bar-add-collection-button"
          label={t['com.affine.rootAppSidebar.collection.new']()}
          onClick={() => handleCreateCollection()}
        />
      </NavigationPanelTreeRoot>
    </CollapsibleSection>
  );
};
