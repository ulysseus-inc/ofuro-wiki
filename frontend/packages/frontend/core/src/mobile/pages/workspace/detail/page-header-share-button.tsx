import { IconButton, MobileMenu } from '@ofuro/component';
import { useEnableCloud } from '@ofuro/core/components/hooks/affine/use-enable-cloud';
import { DocService } from '@ofuro/core/modules/doc';
import { ShareMenuContent } from '@ofuro/core/modules/share-menu';
import { WorkspaceService } from '@ofuro/core/modules/workspace';
import { ShareiOsIcon } from '@blocksuite/icons/rc';
import { useServices } from '@toeverything/infra';

import * as styles from './page-header-share-button.css';

export const PageHeaderShareButton = () => {
  const { workspaceService, docService } = useServices({
    WorkspaceService,
    DocService,
  });
  const workspace = workspaceService.workspace;
  const doc = docService.doc.blockSuiteDoc;
  const confirmEnableCloud = useEnableCloud();

  if (workspace.meta.flavour === 'local') {
    return null;
  }

  return (
    <MobileMenu
      items={
        <div className={styles.content}>
          <ShareMenuContent
            workspaceMetadata={workspace.meta}
            currentPage={doc}
            onEnableAffineCloud={() =>
              confirmEnableCloud(workspace, {
                openPageId: doc.id,
              })
            }
          />
        </div>
      }
    >
      <IconButton size={24} style={{ padding: 10 }} icon={<ShareiOsIcon />} />
    </MobileMenu>
  );
};
