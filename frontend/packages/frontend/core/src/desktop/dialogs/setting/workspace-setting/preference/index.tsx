import {
  SettingHeader,
  SettingRow,
  SettingWrapper,
} from '@ofuro/component/setting-components';
import { WorkspaceServerService } from '@ofuro/core/modules/cloud';
import { WorkspacePermissionService } from '@ofuro/core/modules/permissions';
import { WorkspaceService } from '@ofuro/core/modules/workspace';
import { useI18n } from '@ofuro/i18n';
import { ArrowRightSmallIcon } from '@blocksuite/icons/rc';
import { FrameworkScope, useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect } from 'react';

import { DeleteLeaveWorkspace } from './delete-leave-workspace';
import { ProfilePanel } from './profile';
import { TemplateDocSetting } from './template';
import type { WorkspaceSettingDetailProps } from './types';

export const WorkspaceSettingDetail = ({
  onCloseSetting,
}: WorkspaceSettingDetailProps) => {
  const t = useI18n();

  const workspace = useService(WorkspaceService).workspace;
  const server = workspace?.scope.get(WorkspaceServerService).server;
  const permissionService = useService(WorkspacePermissionService);
  const isOwner = useLiveData(permissionService.permission.isOwner$);
  useEffect(() => {
    permissionService.permission.revalidate();
  }, [permissionService]);

  const handleResetSyncStatus = useCallback(() => {
    workspace?.engine.doc
      .resetSync()
      .then(() => {
        onCloseSetting();
      })
      .catch(err => {
        console.error(err);
      });
  }, [onCloseSetting, workspace]);

  return (
    <FrameworkScope scope={server?.scope}>
      <SettingHeader
        title={t['com.affine.settings.workspace.preferences']()}
        subtitle={t['com.affine.settings.workspace.description']()}
      />
      <SettingWrapper title={t['Info']()}>
        <SettingRow
          name={t['Workspace Profile']()}
          desc={isOwner ? t['com.affine.settings.workspace.owner']() : t['com.affine.settings.workspace.not-owner']()}
          spreadCol={false}
        >
          <ProfilePanel />
        </SettingRow>
      </SettingWrapper>
      <TemplateDocSetting />
      <SettingWrapper>
        <DeleteLeaveWorkspace onCloseSetting={onCloseSetting} />
        <SettingRow
          name={
            <span style={{ color: 'var(--affine-text-secondary-color)' }}>
              {t['com.affine.resetSyncStatus.button']()}
            </span>
          }
          desc={t['com.affine.resetSyncStatus.description']()}
          style={{ cursor: 'pointer' }}
          onClick={handleResetSyncStatus}
          data-testid="reset-sync-status"
        >
          <ArrowRightSmallIcon />
        </SettingRow>
      </SettingWrapper>
    </FrameworkScope>
  );
};
