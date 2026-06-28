import { SignInPanel, type SignInStep } from '@ofuro/core/components/sign-in';
import type { AuthSessionStatus } from '@ofuro/core/modules/cloud/entities/session';
import { useCallback } from 'react';

import { MobileSignInLayout } from './layout';

const logoUrl = '/imgs/ofuro-wiki-logo.png';

export const MobileSignInPanel = ({
  onClose,
  server,
  initStep,
}: {
  onClose: () => void;
  server?: string;
  initStep?: SignInStep;
}) => {
  const onAuthenticated = useCallback(
    (status: AuthSessionStatus) => {
      if (status === 'authenticated') {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <MobileSignInLayout>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <img
          src={logoUrl}
          alt="ofuro-wiki"
          style={{
            width: '80px',
            height: '80px',
            marginBottom: '4px',
            objectFit: 'contain',
          }}
        />
        <span
          style={{
            fontFamily: "'Comfortaa', 'Nunito', sans-serif",
            fontSize: '24px',
            fontWeight: 700,
            color: '#5c3d2e',
            letterSpacing: '-0.5px',
          }}
        >
          ofuro-wiki
        </span>
      </div>
      <SignInPanel
        onSkip={onClose}
        onAuthenticated={onAuthenticated}
        server={server}
        initStep={initStep}
      />
    </MobileSignInLayout>
  );
};
