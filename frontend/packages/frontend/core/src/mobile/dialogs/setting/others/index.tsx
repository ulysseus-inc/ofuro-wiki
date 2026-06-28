import { useI18n } from '@ofuro/i18n';

import { SettingGroup } from '../group';
import { DeleteAccount } from './delete-account';

export const OthersGroup = () => {
  const t = useI18n();

  return (
    <SettingGroup title={t['com.affine.mobile.setting.others.title']()}>
      <DeleteAccount />
    </SettingGroup>
  );
};
