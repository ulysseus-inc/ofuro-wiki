import { UserFeatureService } from '@ofuro/core/modules/cloud/services/user-feature';
import type { SettingTab } from '@ofuro/core/modules/dialogs/constant';
import { useI18n } from '@ofuro/i18n';
import { AdminIcon, SettingsIcon, SaveIcon, ResetIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useEffect, useMemo } from 'react';

import type { SettingSidebarItem, SettingState } from '../types';
import { BackupPanel } from './backup-panel';
import { RestorePanel } from './restore-panel';
import { ServerSettings } from './server-settings';
import { UserManagement } from './user-management';

export type AdminSettingList = SettingSidebarItem[];

export const useAdminSettingList = (): AdminSettingList => {
  const t = useI18n();
  const userFeatureService = useService(UserFeatureService);
  const isAdmin = useLiveData(userFeatureService.userFeature.isAdmin$);

  useEffect(() => {
    userFeatureService.userFeature.revalidate();
  }, [userFeatureService]);

  return useMemo(() => {
    if (!isAdmin) return [];
    return [
      {
        key: 'admin:users' as SettingTab,
        title: t['com.affine.admin.nav.users'](),
        icon: <AdminIcon />,
        testId: 'admin-users-trigger',
      },
      {
        key: 'admin:settings' as SettingTab,
        title: t['com.affine.admin.nav.settings'](),
        icon: <SettingsIcon />,
        testId: 'admin-settings-trigger',
      },
      {
        key: 'admin:backup' as SettingTab,
        title: t['com.affine.admin.nav.backup'](),
        icon: <SaveIcon />,
        testId: 'admin-backup-trigger',
      },
      {
        key: 'admin:restore' as SettingTab,
        title: t['com.affine.admin.nav.restore'](),
        icon: <ResetIcon />,
        testId: 'admin-restore-trigger',
      },
    ];
  }, [isAdmin, t]);
};

interface AdminSettingProps {
  activeTab: SettingTab;
  onChangeSettingState: (settingState: SettingState) => void;
}

export const AdminSetting = ({ activeTab }: AdminSettingProps) => {
  switch (activeTab) {
    case 'admin:users':
      return <UserManagement />;
    case 'admin:settings':
      return <ServerSettings />;
    case 'admin:backup':
      return <BackupPanel />;
    case 'admin:restore':
      return <RestorePanel />;
    default:
      return null;
  }
};
