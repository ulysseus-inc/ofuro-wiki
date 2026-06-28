import { notify } from '@ofuro/component';
import { AffineOtherPageLayout } from '@ofuro/component/affine-other-page-layout';
import { SignInPageContainer } from '@ofuro/component/auth-components';
import { SignInPanel } from '@ofuro/core/components/sign-in';
import { SignInBackgroundArts } from '@ofuro/core/components/sign-in/background-arts';
import type { AuthSessionStatus } from '@ofuro/core/modules/cloud/entities/session';
import { useI18n } from '@ofuro/i18n';
import { useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  RouteLogic,
  useNavigateHelper,
} from '../../../components/hooks/use-navigate-helper';

// Logo image served from public directory
const logoUrl = '/imgs/ofuro-wiki-logo.png';

export const SignIn = ({
  redirectUrl: redirectUrlFromProps,
}: {
  redirectUrl?: string;
}) => {
  const t = useI18n();
  const navigate = useNavigate();
  const { jumpToIndex } = useNavigateHelper();
  const [searchParams] = useSearchParams();
  const redirectUrl = redirectUrlFromProps ?? searchParams.get('redirect_uri');

  const server = searchParams.get('server') ?? undefined;
  const error = searchParams.get('error');

  useEffect(() => {
    if (error) {
      notify.error({
        title: t['com.affine.auth.toast.title.failed'](),
        message: error,
      });
    }
  }, [error, t]);

  const handleClose = useCallback(() => {
    jumpToIndex(RouteLogic.REPLACE, {
      search: searchParams.toString(),
    });
  }, [jumpToIndex, searchParams]);

  const handleAuthenticated = useCallback(
    (status: AuthSessionStatus) => {
      if (status === 'authenticated') {
        if (redirectUrl) {
          if (redirectUrl.toUpperCase() === 'CLOSE_POPUP') {
            window.close();
          }
          navigate(redirectUrl, {
            replace: true,
          });
        } else {
          handleClose();
        }
      }
    },
    [handleClose, navigate, redirectUrl]
  );

  const initStep = server ? 'addSelfhosted' : 'signIn';

  return (
    <SignInPageContainer>
      <div
        style={{
          maxWidth: '400px',
          width: '100%',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <img
          src={logoUrl}
          alt="ofuro-wiki"
          style={{
            width: '120px',
            height: '120px',
            marginBottom: '4px',
            objectFit: 'contain',
          }}
        />
        <span
          style={{
            fontFamily: "'Comfortaa', 'Nunito', sans-serif",
            fontSize: '32px',
            fontWeight: 700,
            color: '#5c3d2e',
            letterSpacing: '-0.5px',
            marginBottom: '20px',
          }}
        >
          ofuro-wiki
        </span>
        <SignInPanel
          onSkip={handleClose}
          onAuthenticated={handleAuthenticated}
          initStep={initStep}
          server={server}
        />
      </div>
    </SignInPageContainer>
  );
};

export const Component = () => {
  return (
    <AffineOtherPageLayout>
      <SignInBackgroundArts />
      <SignIn />
    </AffineOtherPageLayout>
  );
};
