import { Button, notify } from '@ofuro/component';
import {
  AuthPageContainer,
  ChangeEmailPage,
  ChangePasswordPage,
  OnboardingPage,
  SetPasswordPage,
  SignInSuccessPage,
  SignUpPage,
} from '@ofuro/component/auth-components';
import {
  changePasswordMutation,
  isPasswordTokenValidQuery,
  sendVerifyChangeEmailMutation,
} from '@ofuro/graphql';
import { useI18n } from '@ofuro/i18n';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useState } from 'react';
import type { LoaderFunction } from 'react-router-dom';
import { redirect, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { useMutation } from '../../../components/hooks/use-mutation';
import {
  RouteLogic,
  useNavigateHelper,
} from '../../../components/hooks/use-navigate-helper';
import {
  AuthService,
  GraphQLService,
  ServerService,
} from '../../../modules/cloud';
import { AppContainer } from '../../components/app-container';
import { ConfirmChangeEmail } from './confirm-change-email';
import { ConfirmVerifiedEmail } from './email-verified-email';

const authTypeSchema = z.enum([
  'onboarding',
  'setPassword',
  'signIn',
  'changePassword',
  'signUp',
  'changeEmail',
  'confirm-change-email',
  'subscription-redirect',
  'verify-email',
]);

/**
 * #115: 再設定 URL のトークンを、画面を開いた時点で検証する。
 *
 * 検証しないと、使用済み・期限切れの URL でもパスワード入力フォームが出てしまい、
 * 利用者は送信するまで無効だと気づけない（実際に確認で繰り返し指摘された）。
 * 検証クエリは状態を変えず、トークンを消費しない。
 */
const PasswordTokenGate = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const t = useI18n();
  const graphqlService = useService(GraphQLService);
  const { jumpToIndex } = useNavigateHelper();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [valid, setValid] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setValid(false);
      return;
    }
    graphqlService
      .gql({ query: isPasswordTokenValidQuery, variables: { token } })
      .then(res => {
        if (!cancelled) setValid(!!res.isPasswordTokenValid);
      })
      .catch(() => {
        // 通信できない場合はフォームを出す（送信時に改めて検証される）。
        // ここで「無効」と断定すると、有効な URL を持つ人を締め出してしまう。
        if (!cancelled) setValid(true);
      });
    return () => {
      cancelled = true;
    };
  }, [graphqlService, token]);

  if (valid === null) {
    return <AppContainer fallback />;
  }

  if (!valid) {
    return (
      <AuthPageContainer
        title={t['com.affine.auth.reset.password.expired.title']()}
        subtitle={t['com.affine.auth.reset.password.expired.subtitle']()}
      >
        <Button
          variant="primary"
          size="large"
          onClick={() => jumpToIndex(RouteLogic.REPLACE)}
        >
          {t['com.affine.auth.open.affine']()}
        </Button>
      </AuthPageContainer>
    );
  }

  return <>{children}</>;
};

export const Component = () => {
  const authService = useService(AuthService);
  const account = useLiveData(authService.session.account$);
  const t = useI18n();
  const serverService = useService(ServerService);
  const passwordLimits = useLiveData(
    serverService.server.credentialsRequirement$.map(r => r?.password)
  );

  const { authType } = useParams();
  const [searchParams] = useSearchParams();

  const { trigger: changePassword } = useMutation({
    mutation: changePasswordMutation,
  });

  const { trigger: sendVerifyChangeEmail } = useMutation({
    mutation: sendVerifyChangeEmailMutation,
  });

  const { jumpToIndex } = useNavigateHelper();

  const onSendVerifyChangeEmail = useCallback(
    async (email: string) => {
      const res = await sendVerifyChangeEmail({
        token: searchParams.get('token') || '',
        email,
        callbackUrl: `/auth/confirm-change-email`,
      }).catch(console.error);

      // FIXME: There is not notification
      if (res?.sendVerifyChangeEmail) {
        notify.success({
          title: t['com.affine.auth.sent.verify.email.hint'](),
        });
      } else {
        notify.error({
          title: t['com.affine.auth.sent.change.email.fail'](),
        });
      }

      return !!res?.sendVerifyChangeEmail;
    },
    [searchParams, sendVerifyChangeEmail, t]
  );

  const onSetPassword = useCallback(
    async (password: string) => {
      await changePassword({
        token: searchParams.get('token') || '',
        userId: searchParams.get('userId') || '',
        newPassword: password,
      });
    },
    [changePassword, searchParams]
  );
  const onOpenAffine = useCallback(() => {
    jumpToIndex(RouteLogic.REPLACE);
  }, [jumpToIndex]);

  if (!passwordLimits) {
    return <AppContainer fallback />;
  }

  switch (authType) {
    case 'onboarding':
      return (
        account && <OnboardingPage user={account} onOpenAffine={onOpenAffine} />
      );
    case 'signUp': {
      return (
        account && (
          <SignUpPage
            user={account}
            passwordLimits={passwordLimits}
            onSetPassword={onSetPassword}
            onOpenAffine={onOpenAffine}
          />
        )
      );
    }
    case 'signIn': {
      return <SignInSuccessPage onOpenAffine={onOpenAffine} />;
    }
    case 'changePassword': {
      return (
        <PasswordTokenGate>
          <ChangePasswordPage
            passwordLimits={passwordLimits}
            onSetPassword={onSetPassword}
            onOpenAffine={onOpenAffine}
          />
        </PasswordTokenGate>
      );
    }
    case 'setPassword': {
      return (
        <PasswordTokenGate>
          <SetPasswordPage
            passwordLimits={passwordLimits}
            onSetPassword={onSetPassword}
            onOpenAffine={onOpenAffine}
          />
        </PasswordTokenGate>
      );
    }
    case 'changeEmail': {
      return (
        <ChangeEmailPage
          onChangeEmail={onSendVerifyChangeEmail}
          onOpenAffine={onOpenAffine}
        />
      );
    }
    case 'confirm-change-email': {
      return <ConfirmChangeEmail onOpenAffine={onOpenAffine} />;
    }
    case 'verify-email': {
      return <ConfirmVerifiedEmail onOpenAffine={onOpenAffine} />;
    }
  }
  return null;
};

export const loader: LoaderFunction = async args => {
  if (!args.params.authType) {
    return redirect('/404');
  }
  if (!authTypeSchema.safeParse(args.params.authType).success) {
    return redirect('/404');
  }

  return null;
};
