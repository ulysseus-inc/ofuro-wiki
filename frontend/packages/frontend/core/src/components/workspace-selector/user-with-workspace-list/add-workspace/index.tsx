import { MenuItem } from '@ofuro/component/ui/menu';
import { DefaultServerService } from '@ofuro/core/modules/cloud';
import { ServerFeature } from '@ofuro/graphql';
import { useI18n } from '@ofuro/i18n';
import { ImportIcon, PlusIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';

import * as styles from './index.css';

export const AddWorkspace = ({
  onAddWorkspace,
  onNewWorkspace,
}: {
  onAddWorkspace?: () => void;
  onNewWorkspace?: () => void;
}) => {
  const t = useI18n();
  const defaultServerService = useService(DefaultServerService);
  const enableLocalWorkspace = useLiveData(
    defaultServerService.server.config$.selector(
      c =>
        c.features.includes(ServerFeature.LocalWorkspace) ||
        BUILD_CONFIG.isNative
    )
  );

  return (
    <>
      {BUILD_CONFIG.isElectron && (
        <MenuItem
          block={true}
          prefixIcon={<ImportIcon />}
          prefixIconClassName={styles.prefixIcon}
          onClick={onAddWorkspace}
          data-testid="add-workspace"
          className={styles.ItemContainer}
        >
          <div className={styles.ItemText}>
            {t['com.affine.workspace.local.import']()}
          </div>
        </MenuItem>
      )}
      <MenuItem
        block={true}
        prefixIcon={<PlusIcon />}
        prefixIconClassName={styles.prefixIcon}
        onClick={onNewWorkspace}
        data-testid="new-workspace"
        className={styles.ItemContainer}
      >
        <div className={styles.ItemText}>
          {enableLocalWorkspace
            ? t['com.affine.workspaceList.addWorkspace.create']()
            : t['com.affine.workspaceList.addWorkspace.create-cloud']()}
        </div>
      </MenuItem>
    </>
  );
};
