import { Button, Tooltip } from '@ofuro/component';
import { SettingRow } from '@ofuro/component/setting-components';
import { AffineErrorBoundary } from '@ofuro/core/components/affine/affine-error-boundary';
import { useWorkspaceInfo } from '@ofuro/core/components/hooks/use-workspace-info';
import { WorkspaceService } from '@ofuro/core/modules/workspace';
import { useI18n } from '@ofuro/i18n';
import { useService } from '@toeverything/infra';
import type { ReactElement } from 'react';

import type { SettingState } from '../../types';
import { EnableCloudPanel } from '../preference/enable-cloud';
import { CloudWorkspaceMembersPanel } from './cloud-members-panel';
import * as styles from './styles.css';

export const MembersPanel = ({
  onChangeSettingState,
  onCloseSetting,
}: {
  onChangeSettingState: (settingState: SettingState) => void;
  onCloseSetting: () => void;
}): ReactElement | null => {
  const workspace = useService(WorkspaceService).workspace;
  const isTeam = useWorkspaceInfo(workspace.meta)?.isTeam;
  if (workspace.flavour === 'local') {
    return <MembersPanelLocal onCloseSetting={onCloseSetting} />;
  }
  return (
    <AffineErrorBoundary>
      <CloudWorkspaceMembersPanel
        onChangeSettingState={onChangeSettingState}
        isTeam={isTeam}
      />
    </AffineErrorBoundary>
  );
};

const MembersPanelLocal = ({
  onCloseSetting,
}: {
  onCloseSetting: () => void;
}) => {
  const t = useI18n();
  return (
    <div className={styles.localMembersPanel}>
      <Tooltip content={t['com.affine.settings.member-tooltip']()}>
        <div className={styles.fakeWrapper}>
          <SettingRow name={`${t['Members']()} (0)`} desc={t['Members hint']()}>
            <Button>{t['Invite Members']()}</Button>
          </SettingRow>
        </div>
      </Tooltip>
      <EnableCloudPanel onCloseSetting={onCloseSetting} />
    </div>
  );
};
