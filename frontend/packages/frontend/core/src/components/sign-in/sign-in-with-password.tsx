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
  // #93: レート制限（429）に掛かった状態。パスワードの照合自体が行われていないため、
  // 「パスワードが無効」と表示すると事実と異なる（正しいパスワードでも同じ表示になる）。
  const [rateLimited, setRateLimited] = useState(false);
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
      // #93: 429（レート制限）はパスワードの正誤と無関係なので、区別して表示する。
      // レート制限は「IP + 入力されたメールアドレス」単位で、存在しない
      // メールアドレスでも同じように掛かるため、アカウント列挙の手がかりにならない。
      //
      // ステータスコードで判定する。メッセージ文字列での判定は、文言が変われば
      // 静かに壊れる（レート制限中に「パスワードが無効」と誤表示される）ため、
      // 旧サーバーとの組み合わせに備えたフォールバックとしてのみ残す。
      const error = err as { status?: number; name?: string; message?: string };
      const isRateLimited =
        error?.status === 429 ||
        error?.name === 'TOO_MANY_REQUESTS' ||
        /too many requests|throttler/i.test(String(error?.message ?? ''));
      setRateLimited(isRateLimited);
      setPasswordError(!isRateLimited);
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
        {rateLimited && (
          <div data-testid="rate-limited-hint" className={styles.rateLimitedHint}>
            {t['com.affine.auth.password.rate-limited']()}
          </div>
        )}
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
