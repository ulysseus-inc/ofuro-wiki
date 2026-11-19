import {
  SettingHeader,
  SettingWrapper,
} from '@ofuro/component/setting-components';
import { WorkspacePermissionService } from '@ofuro/core/modules/permissions';
import { WorkspaceService } from '@ofuro/core/modules/workspace';
import { useI18n } from '@ofuro/i18n';
import { useLiveData, useService } from '@toeverything/infra';
import { useEffect } from 'react';

import { CurrentWorkspaceNote } from '../current-workspace-note';
import { EnableCloudPanel } from '../preference/enable-cloud';
import { BackupExportPanel } from './backup-export';
import { BlobManagementPanel } from './blob-management';
import { DesktopExportPanel } from './export';
import { WorkspaceQuotaPanel } from './workspace-quota';

export const WorkspaceSettingStorage = ({
  onCloseSetting,
}: {
  onCloseSetting: () => void;
}) => {
  const t = useI18n();
  const workspace = useService(WorkspaceService).workspace;
  const workspacePermissionService = useService(
    WorkspacePermissionService
  ).permission;
  const isTeam = useLiveData(workspacePermissionService.isTeam$);
  const isOwner = useLiveData(workspacePermissionService.isOwner$);
  const isAdmin = useLiveData(workspacePermissionService.isAdmin$);
  const isShared = useLiveData(workspacePermissionService.isShared$);
  // 種類と役割を取り直す（手元の控えは古いことがある。メンバーの設定と同じ）
  useEffect(() => {
    workspacePermissionService.revalidate();
  }, [workspacePermissionService]);

  // #297: 共有はシステム管理者（役割が Owner で返る）・ワークスペース管理者、プライベートは本人だけ
  // （docs/workspace-model.md 12.6）
  const canExport = isShared ? !!(isOwner || isAdmin) : !!isOwner;
  return (
    <>
      <SettingHeader
        title={t['Storage']()}
        subtitle={t['com.affine.settings.workspace.storage.subtitle']()}
      />
      <CurrentWorkspaceNote />
      {workspace.flavour === 'local' ? (
        <>
          <EnableCloudPanel onCloseSetting={onCloseSetting} />{' '}
          {BUILD_CONFIG.isElectron && (
            <SettingWrapper>
              <DesktopExportPanel workspace={workspace} />
            </SettingWrapper>
          )}
        </>
      ) : (
        <>
          {isTeam ? (
            <SettingWrapper>
              <WorkspaceQuotaPanel />
            </SettingWrapper>
          ) : null}

          {BUILD_CONFIG.isElectron && canExport && (
            <SettingWrapper>
              <DesktopExportPanel workspace={workspace} />
            </SettingWrapper>
          )}

          {canExport && (
            <SettingWrapper>
              <BackupExportPanel />
            </SettingWrapper>
          )}

          <SettingWrapper>
            <BlobManagementPanel />
          </SettingWrapper>
        </>
      )}
    </>
  );
};
