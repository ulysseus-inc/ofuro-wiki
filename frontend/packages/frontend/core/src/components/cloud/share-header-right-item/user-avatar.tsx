import { Avatar } from '@ofuro/component/ui/avatar';
import { Menu, MenuItem, MenuSeparator } from '@ofuro/component/ui/menu';
import { useAsyncCallback } from '@ofuro/core/components/hooks/affine-async-hooks';
import { useI18n } from '@ofuro/i18n';
import { SignOutIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useMemo } from 'react';

import { AuthService } from '../../../modules/cloud';
import { useNavigateHelper } from '../../hooks/use-navigate-helper';
import * as styles from './styles.css';

const UserInfo = () => {
  const authService = useService(AuthService);
  const user = useLiveData(authService.session.account$);

  if (!user) {
    // TODO(@eyhn): loading UI
    return null;
  }
  return (
    <div className={styles.accountCard}>
      <Avatar
        size={28}
        name={user.label}
        url={user.avatar}
        className={styles.avatar}
      />

      <div className={styles.content}>
        <div className={styles.nameContainer}>
          <div className={styles.userName} title={user.label}>
            {user.label}
          </div>

        </div>
        <div className={styles.userEmail} title={user.email}>
          {user.email}
        </div>
      </div>
    </div>
  );
};

export const PublishPageUserAvatar = () => {
  const authService = useService(AuthService);
  const user = useLiveData(authService.session.account$);
  const t = useI18n();

  const navigateHelper = useNavigateHelper();
  const handleSignOut = useAsyncCallback(async () => {
    await authService.signOut();
    navigateHelper.jumpToSignIn();
  }, [authService, navigateHelper]);

  const menuItem = useMemo(() => {
    return (
      <>
        <UserInfo />
        <MenuSeparator />
        <MenuItem
          prefixIcon={<SignOutIcon />}
          data-testid="share-page-sign-out-option"
          onClick={handleSignOut}
        >
          {t['com.affine.workspace.cloud.account.logout']()}
        </MenuItem>
      </>
    );
  }, [handleSignOut, t]);

  if (!user) {
    return null;
  }

  return (
    <Menu
      items={menuItem}
      contentOptions={{
        align: 'end',
      }}
    >
      <div className={styles.iconWrapper} data-testid="share-page-user-avatar">
        <Avatar size={24} url={user.avatar} name={user.label} />
      </div>
    </Menu>
  );
};
