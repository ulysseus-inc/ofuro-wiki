import { useWorkspaceInfo } from '@ofuro/core/components/hooks/use-workspace-info';
import type { SettingTab } from '@ofuro/core/modules/dialogs/constant';
import { WorkspaceService } from '@ofuro/core/modules/workspace';
import { useI18n } from '@ofuro/i18n';
import {
  CollaborationIcon,
  PropertyIcon,
  SaveIcon,
  SettingsIcon,
} from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import { useMemo } from 'react';

import type { SettingSidebarItem, SettingState } from '../types';
import { MembersPanel } from './members';
import { WorkspaceSettingDetail } from './preference';
import { WorkspaceSettingProperties } from './properties';
import { WorkspaceSettingStorage } from './storage';

export const WorkspaceSetting = ({
  activeTab,
  onCloseSetting,
  onChangeSettingState,
}: {
  activeTab: SettingTab;
  onCloseSetting: () => void;
  onChangeSettingState: (settingState: SettingState) => void;
}) => {
  switch (activeTab) {
    case 'workspace:preference':
      return <WorkspaceSettingDetail onCloseSetting={onCloseSetting} />;
    case 'workspace:properties':
      return <WorkspaceSettingProperties />;
    case 'workspace:members':
      return (
        <MembersPanel
          onCloseSetting={onCloseSetting}
          onChangeSettingState={onChangeSettingState}
        />
      );
    case 'workspace:storage':
      return <WorkspaceSettingStorage onCloseSetting={onCloseSetting} />;
    default:
      return null;
  }
};

export const useWorkspaceSettingList = (): SettingSidebarItem[] => {
  const workspaceService = useService(WorkspaceService);
  const information = useWorkspaceInfo(workspaceService.workspace);

  const t = useI18n();

  const items = useMemo<SettingSidebarItem[]>(() => {
    return [
      {
        key: 'workspace:preference',
        title: t['com.affine.settings.workspace.preferences'](),
        icon: <SettingsIcon />,
        testId: 'workspace-setting:preference',
      },
      {
        key: 'workspace:properties',
        title: t['com.affine.settings.workspace.properties'](),
        icon: <PropertyIcon />,
        testId: 'workspace-setting:properties',
      },
      {
        key: 'workspace:members',
        title: t['Members'](),
        icon: <CollaborationIcon />,
        testId: 'workspace-setting:members',
      },
      {
        key: 'workspace:storage',
        title: t['Storage'](),
        icon: <SaveIcon />,
        testId: 'workspace-setting:storage',
      },
    ];
  }, [t]);

  return items;
};
