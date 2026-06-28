import { ScrollableContainer } from '@ofuro/component';
import { MenuItem } from '@ofuro/component/ui/menu';
import { GlobalDialogService } from '@ofuro/core/modules/dialogs';
import { type WorkspaceMetadata } from '@ofuro/core/modules/workspace';
import { useI18n } from '@ofuro/i18n';
import { track } from '@ofuro/track';
import { Logo1Icon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import { useCallback } from 'react';

import * as styles from './index.css';
import { AFFiNEWorkspaceList } from './workspace-list';

export const SignInItem = () => {
  const globalDialogService = useService(GlobalDialogService);

  const t = useI18n();

  const onClickSignIn = useCallback(() => {
    track.$.navigationPanel.workspaceList.requestSignIn();
    globalDialogService.open('sign-in', {});
  }, [globalDialogService]);

  return (
    <MenuItem
      className={styles.menuItem}
      onClick={onClickSignIn}
      data-testid="cloud-signin-button"
    >
      <div className={styles.signInWrapper}>
        <div className={styles.iconContainer}>
          <Logo1Icon />
        </div>

        <div className={styles.signInTextContainer}>
          <div className={styles.signInTextPrimary}>
            {t['com.affine.workspace.cloud.auth']()}
          </div>
          <div className={styles.signInTextSecondary}>
            {t['com.affine.workspace.cloud.description']()}
          </div>
        </div>
      </div>
    </MenuItem>
  );
};

interface UserWithWorkspaceListProps {
  onEventEnd?: () => void;
  onClickWorkspace?: (workspace: WorkspaceMetadata) => void;
  onCreatedWorkspace?: (payload: {
    metadata: WorkspaceMetadata;
    defaultDocId?: string;
  }) => void;
  showEnableCloudButton?: boolean;
}

export const UserWithWorkspaceList = ({
  onEventEnd,
  onClickWorkspace,
  showEnableCloudButton,
}: UserWithWorkspaceListProps) => {
  return (
    <ScrollableContainer
      className={styles.workspaceScrollArea}
      viewPortClassName={styles.workspaceScrollAreaViewport}
      scrollBarClassName={styles.scrollbar}
      scrollThumbClassName={styles.scrollbarThumb}
    >
      <AFFiNEWorkspaceList
        onEventEnd={onEventEnd}
        onClickWorkspace={onClickWorkspace}
        showEnableCloudButton={showEnableCloudButton}
      />
    </ScrollableContainer>
  );
};
