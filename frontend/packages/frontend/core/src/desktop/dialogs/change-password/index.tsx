import { Button, Modal, notify } from '@ofuro/component';
import {
  AuthContent,
  AuthHeader,
  AuthInput,
} from '@ofuro/component/auth-components';
import { useAsyncCallback } from '@ofuro/core/components/hooks/affine-async-hooks';
import {
  AuthService,
  DefaultServerService,
  ServersService,
} from '@ofuro/core/modules/cloud';
import type {
  DialogComponentProps,
  GLOBAL_DIALOG_SCHEMA,
} from '@ofuro/core/modules/dialogs';
import { Unreachable } from '@ofuro/env/constant';
import { changePasswordDirectMutation } from '@ofuro/graphql';
import { useI18n } from '@ofuro/i18n';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useState } from 'react';

export const ChangePasswordDialog = ({
  close,
  server: serverBaseUrl,
}: DialogComponentProps<GLOBAL_DIALOG_SCHEMA['change-password']>) => {
  const t = useI18n();
  const defaultServerService = useService(DefaultServerService);
  const serversService = useService(ServersService);
  let server;

  if (serverBaseUrl) {
    server = serversService.getServerByBaseUrl(serverBaseUrl);
    if (!server) {
      throw new Unreachable('Server not found');
    }
  } else {
    server = defaultServerService.server;
  }

  const authService = server.scope.get(AuthService);
  const account = useLiveData(authService.session.account$);
  const serverName = useLiveData(server.config$.selector(c => c.serverName));

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!account) {
      close();
    }
  }, [account, close]);

  const onSubmit = useAsyncCallback(async () => {
    if (newPassword !== confirmPassword) {
      notify.error({
        title: t['com.affine.auth.password.confirm.mismatch']?.() || 'Passwords do not match',
      });
      return;
    }
    if (newPassword.length < 8) {
      notify.error({
        title: t['com.affine.auth.password.too.short']?.() || 'Password must be at least 8 characters',
      });
      return;
    }

    setLoading(true);
    try {
      await server.gql({
        query: changePasswordDirectMutation,
        variables: {
          currentPassword,
          newPassword,
        },
      });

      notify.success({
        title: t['com.affine.auth.password.changed.successfully']?.() || 'Password changed successfully',
      });
      close();
    } catch (err: any) {
      console.error(err);
      const message = err?.message?.includes('Wrong password')
        ? (t['com.affine.auth.password.wrong']?.() || 'Current password is incorrect')
        : (t['com.affine.auth.password.change.failed']?.() || 'Failed to change password');
      notify.error({ title: message });
    } finally {
      setLoading(false);
    }
  }, [currentPassword, newPassword, confirmPassword, server, t, close]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && currentPassword && newPassword && confirmPassword) {
        onSubmit();
      }
    },
    [currentPassword, newPassword, confirmPassword, onSubmit]
  );

  return (
    <Modal
      open
      onOpenChange={() => close()}
      width={400}
      minHeight={500}
      contentOptions={{
        ['data-testid' as string]: 'change-password-modal',
        style: { padding: '44px 40px 20px' },
      }}
    >
      <AuthHeader
        title={serverName}
        subTitle={t['com.affine.auth.reset.password']()}
      />
      <AuthContent>
        <div onKeyDown={handleKeyDown}>
          <AuthInput
            label={t['com.affine.auth.password.current']?.() || 'Current password'}
            type="password"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoFocus
          />
          <AuthInput
            label={t['com.affine.auth.password.new']?.() || 'New password'}
            type="password"
            value={newPassword}
            onChange={setNewPassword}
          />
          <AuthInput
            label={t['com.affine.auth.password.confirm']?.() || 'Confirm new password'}
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
          />
        </div>
        <Button
          variant="primary"
          size="extraLarge"
          style={{ width: '100%', marginTop: 20 }}
          disabled={!currentPassword || !newPassword || !confirmPassword}
          loading={loading}
          onClick={onSubmit}
        >
          {t['com.affine.auth.reset.password']()}
        </Button>
      </AuthContent>
    </Modal>
  );
};
