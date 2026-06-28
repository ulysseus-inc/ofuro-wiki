import { notify } from '@ofuro/component';
import {
  AuthContainer,
  AuthContent,
  AuthHeader,
  AuthInput,
} from '@ofuro/component/auth-components';
import { Button } from '@ofuro/component/ui/button';
import { useAsyncCallback } from '@ofuro/core/components/hooks/affine-async-hooks';
import {
  AuthService,
  CaptchaService,
  ServerService,
} from '@ofuro/core/modules/cloud';
import type { AuthSessionStatus } from '@ofuro/core/modules/cloud/entities/session';
import { Unreachable } from '@ofuro/env/constant';
import { ServerDeploymentType } from '@ofuro/graphql';
import { useI18n } from '@ofuro/i18n';
import { useLiveData, useService } from '@toeverything/infra';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useState } from 'react';

import type { SignInState } from '.';
import { Captcha } from './captcha';
import * as styles from './style.css';

export const SignInWithPasswordStep = ({
  state,
  changeState,
  onAuthenticated,
}: {
  state: SignInState;
  changeState: Dispatch<SetStateAction<SignInState>>;
  onAuthenticated?: (status: AuthSessionStatus) => void;
}) => {
  const t = useI18n();
  const authService = useService(AuthService);

  const email = state.email;

  if (!email) {
    throw new Unreachable();
  }

  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const captchaService = useService(CaptchaService);
  const serverService = useService(ServerService);
  const isSelfhosted = useLiveData(
    serverService.server.config$.selector(
      c => c.type === ServerDeploymentType.Selfhosted
    )
  );

  const verifyToken = useLiveData(captchaService.verifyToken$);
  const needCaptcha = useLiveData(captchaService.needCaptcha$);
  const challenge = useLiveData(captchaService.challenge$);
  const [isLoading, setIsLoading] = useState(false);

  const loginStatus = useLiveData(authService.session.status$);

  useEffect(() => {
    if (loginStatus === 'authenticated') {
      notify.success({
        title: t['com.affine.auth.toast.title.signed-in'](),
        message: t['com.affine.auth.toast.message.signed-in'](),
      });
      onAuthenticated?.(loginStatus);
    }
  }, [loginStatus, onAuthenticated, t]);

  const onSignIn = useAsyncCallback(async () => {
    if (isLoading || (!verifyToken && needCaptcha)) return;
    setIsLoading(true);

    try {
      captchaService.revalidate();
      await authService.signInPassword({
        email,
        password,
        verifyToken,
        challenge,
      });
      // Success — keep isLoading true until page navigates away
    } catch (err) {
      console.error(err);
      setPasswordError(true);
      setIsLoading(false);
    }
  }, [
    isLoading,
    verifyToken,
    needCaptcha,
    captchaService,
    authService,
    email,
    password,
    challenge,
  ]);

  const sendMagicLink = useCallback(() => {
    changeState(prev => ({ ...prev, step: 'signInWithEmail' }));
  }, [changeState]);

  const isNewUser = state.registered === false;
  const userName = state.userName;

  const title = isNewUser
    ? t['com.affine.auth.sign.new-user.title']()
    : userName
      ? t['com.affine.auth.sign.welcome-back']({ name: userName })
      : t['com.affine.auth.sign.welcome-back.no-name']();

  return (
    <AuthContainer>
      <AuthHeader title={title} />

      <AuthContent>
        {isNewUser && (
          <div style={{ fontSize: 14, color: 'var(--affine-text-secondary-color)', marginBottom: 8 }}>
            {t['com.affine.auth.sign.new-user.hint']()}
          </div>
        )}
        <AuthInput
          label={t['com.affine.settings.email']()}
          disabled={true}
          value={email}
        />
        <AuthInput
          autoFocus
          data-testid="password-input"
          label={t['com.affine.auth.password']()}
          value={password}
          type="password"
          onChange={useCallback((value: string) => {
            setPassword(value);
          }, [])}
          error={passwordError}
          errorHint={t['com.affine.auth.password.error']()}
          onEnter={onSignIn}
        />
        {!isSelfhosted && !isNewUser && (
          <div className={styles.passwordButtonRow}>
            <a
              data-testid="send-magic-link-button"
              className={styles.linkButton}
              onClick={sendMagicLink}
            >
              {t['com.affine.auth.sign.auth.code.send-email.sign-in']()}
            </a>
          </div>
        )}
        {!verifyToken && needCaptcha && <Captcha />}
        <Button
          data-testid="sign-in-button"
          variant={isLoading ? 'secondary' : 'primary'}
          size="extraLarge"
          style={{ width: '100%' }}
          disabled={isLoading || (!verifyToken && needCaptcha)}
          loading={isLoading}
          onClick={onSignIn}
        >
          {isLoading
            ? (isNewUser ? t['com.affine.auth.sign.create-account']() : t['com.affine.auth.sign.in']()) + '...'
            : isNewUser
              ? t['com.affine.auth.sign.create-account']()
              : t['com.affine.auth.sign.in']()}
        </Button>
        {isNewUser && (
          <Button
            variant="secondary"
            size="extraLarge"
            style={{ width: '100%' }}
            onClick={useCallback(() => changeState(prev => ({ ...prev, step: 'signIn' })), [changeState])}
          >
            ログイン画面に戻る
          </Button>
        )}
      </AuthContent>
    </AuthContainer>
  );
};
