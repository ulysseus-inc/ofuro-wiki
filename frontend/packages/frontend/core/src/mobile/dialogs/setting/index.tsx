import { AuthService } from '@ofuro/core/modules/cloud';
import type {
  DialogComponentProps,
  WORKSPACE_DIALOG_SCHEMA,
} from '@ofuro/core/modules/dialogs';
import { useI18n } from '@ofuro/i18n';
import { useService } from '@toeverything/infra';
import { useEffect } from 'react';

import { AboutGroup } from './about';
import { AppearanceGroup } from './appearance';
import { ExperimentalFeatureSetting } from './experimental';
import { OthersGroup } from './others';
import * as styles from './style.css';
import { SwipeDialog } from './swipe-dialog';
import { UserProfile } from './user-profile';

// #105: 使用量の帯グラフ（旧 UserUsage）は消した。バックエンドが返すのは
// AFFiNE クラウド版に形を合わせた固定値（上限 100GB・使用量は常に 0）で、
// セルフホストの実態を表していない。実データは PC 版の
// ワークスペース設定 → ストレージ（Blob 管理）で見る

const MobileSetting = () => {
  const session = useService(AuthService).session;
  useEffect(() => session.revalidate(), [session]);

  return (
    <div className={styles.root}>
      <UserProfile />
      <AppearanceGroup />
      <AboutGroup />
      <ExperimentalFeatureSetting />
      <OthersGroup />
    </div>
  );
};

export const SettingDialog = ({
  close,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['setting']>) => {
  const t = useI18n();

  return (
    <SwipeDialog
      title={t['com.affine.mobile.setting.header-title']()}
      open
      onOpenChange={() => close()}
    >
      <MobileSetting />
    </SwipeDialog>
  );

  // return (
  //   <ConfigModal
  //     title={t['com.affine.mobile.setting.header-title']()}
  //     open
  //     onOpenChange={() => close()}
  //     onBack={close}
  //   >
  //     <MobileSetting />
  //   </ConfigModal>
  // );
};
