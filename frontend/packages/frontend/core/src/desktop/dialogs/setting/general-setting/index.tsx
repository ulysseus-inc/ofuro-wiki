import { UserFeatureService } from '@ofuro/core/modules/cloud/services/user-feature';
import type { SettingTab } from '@ofuro/core/modules/dialogs/constant';
import { FeatureFlagService } from '@ofuro/core/modules/feature-flag';
import { useI18n } from '@ofuro/i18n';
import {
  AppearanceIcon,
  ExperimentIcon,
  InformationIcon,
  KeyboardIcon,
  NotificationIcon,
  PenIcon,
} from '@blocksuite/icons/rc';
import { useLiveData, useServices } from '@toeverything/infra';
import { useEffect, useMemo } from 'react';

import { AuthService, ServerService } from '../../../../modules/cloud';
import type { SettingSidebarItem, SettingState } from '../types';
import { AboutAffine } from './about';
import { AppearanceSettings } from './appearance';
import { EditorSettings } from './editor';
import { ExperimentalFeatures } from './experimental-features';
import { NotificationSettings } from './notifications';
import { Shortcuts } from './shortcuts';

export type GeneralSettingList = SettingSidebarItem[];

export const useGeneralSettingList = (): GeneralSettingList => {
  const t = useI18n();
  const {
    authService,
    userFeatureService,
    featureFlagService,
  } = useServices({
    AuthService,
    ServerService,
    UserFeatureService,
    FeatureFlagService,
  });
  const status = useLiveData(authService.session.status$);
  const loggedIn = status === 'authenticated';
  const enableEditorSettings = useLiveData(
    featureFlagService.flags.enable_editor_settings.$
  );

  useEffect(() => {
    userFeatureService.userFeature.revalidate();
  }, [userFeatureService]);

  return useMemo(() => {
    const settings: GeneralSettingList = [
      {
        key: 'appearance',
        title: t['com.affine.settings.appearance'](),
        icon: <AppearanceIcon />,
        testId: 'appearance-panel-trigger',
      },
      {
        key: 'shortcuts',
        title: t['com.affine.keyboardShortcuts.title'](),
        icon: <KeyboardIcon />,
        testId: 'shortcuts-panel-trigger',
      },
    ];
    if (loggedIn) {
      settings.push({
        key: 'notifications',
        title: t['com.affine.setting.notifications'](),
        icon: <NotificationIcon />,
        testId: 'notifications-panel-trigger',
      });
    }
    if (enableEditorSettings) {
      // add editor settings to second position
      settings.splice(1, 0, {
        key: 'editor',
        title: t['com.affine.settings.editorSettings'](),
        icon: <PenIcon />,
        testId: 'editor-panel-trigger',
      });
    }

    settings.push(
      {
        key: 'experimental-features',
        title: t['com.affine.settings.workspace.experimental-features'](),
        icon: <ExperimentIcon />,
        testId: 'experimental-features-trigger',
      },
      {
        key: 'about',
        title: t['com.affine.aboutAFFiNE.title'](),
        icon: <InformationIcon />,
        testId: 'about-panel-trigger',
      }
    );
    return settings;
  }, [
    t,
    loggedIn,
    enableEditorSettings,
  ]);
};

interface GeneralSettingProps {
  activeTab: SettingTab;
  onChangeSettingState: (settingState: SettingState) => void;
}

export const GeneralSetting = ({
  activeTab,
  onChangeSettingState,
}: GeneralSettingProps) => {
  switch (activeTab) {
    case 'shortcuts':
      return <Shortcuts />;
    case 'notifications':
      return <NotificationSettings />;
    case 'editor':
      return <EditorSettings />;
    case 'appearance':
      return <AppearanceSettings />;
    case 'about':
      return <AboutAffine />;
    case 'experimental-features':
      return <ExperimentalFeatures />;
    default:
      return null;
  }
};
