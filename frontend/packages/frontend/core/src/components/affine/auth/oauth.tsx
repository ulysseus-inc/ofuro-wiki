import { Button } from '@ofuro/component/ui/button';
import { notify } from '@ofuro/component/ui/notification';
import { useAsyncCallback } from '@ofuro/core/components/hooks/affine-async-hooks';
import { AuthService, ServerService } from '@ofuro/core/modules/cloud';
import { UrlService } from '@ofuro/core/modules/url';
import { UserFriendlyError } from '@ofuro/error';
import { OAuthProviderType } from '@ofuro/graphql';
import track from '@ofuro/track';
import {
  AppleIcon,
  GithubIcon,
  GoogleIcon,
  LockIcon,
} from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import {
  type ReactElement,
  type SVGAttributes,
  useCallback,
  useEffect,
} from 'react';

const OAuthProviderMap: Record<
  OAuthProviderType,
  {
    icon: ReactElement<SVGAttributes<SVGElement>>;
  }
> = {
  [OAuthProviderType.Google]: {
    icon: <GoogleIcon />,
  },

  [OAuthProviderType.GitHub]: {
    icon: <GithubIcon />,
  },

  [OAuthProviderType.OIDC]: {
    icon: <LockIcon />,
  },

  [OAuthProviderType.Apple]: {
    icon: <AppleIcon />,
  },
};

export function OAuth({ redirectUrl }: { redirectUrl?: string }) {
  const serverService = useService(ServerService);
  const urlService = useService(UrlService);
  const oauth = useLiveData(serverService.server.features$.map(r => r?.oauth));
  const oauthProviders = useLiveData(
    serverService.server.config$.map(r => r?.oauthProviders)
  );
  // #89: SSO ボタンの文言は管理画面で設定できる（例:「Keycloak でサインイン」）。
  // 利用者にとっては「どの IdP のボタンか」が唯一の手がかりなので、設定を反映する。
  const oidcButtonLabel = useLiveData(
    serverService.server.config$.map(r => r?.oidcButtonLabel)
  );

  // ⚠️ サーバー設定は起動時に一度しか取得されない。
  // 管理者が SSO を有効にした直後は、サインアウトしてもボタンが出ず、
  // 「設定したのに反映されない」と見える（リロードすれば出る）。
  // サインイン画面はまさに設定が効いているか確かめる場所なので、
  // 表示のたびに取り直す。
  useEffect(() => {
    serverService.server.revalidateConfig();
  }, [serverService]);
  const auth = useService(AuthService);

  const onContinue = useAsyncCallback(
    async (provider: OAuthProviderType) => {
      track.$.$.auth.signIn({ method: 'oauth', provider });

      const open: () => Promise<void> | void = BUILD_CONFIG.isNative
        ? async () => {
            try {
              const scheme = urlService.getClientScheme();
              const options = await auth.oauthPreflight(
                provider,
                scheme ?? 'web'
              );
              urlService.openPopupWindow(options.url);
            } catch (e) {
              notify.error(UserFriendlyError.fromAny(e));
            }
          }
        : () => {
            const params = new URLSearchParams();

            params.set('provider', provider);

            if (redirectUrl) {
              params.set('redirect_uri', redirectUrl);
            }

            const oauthUrl =
              serverService.server.baseUrl +
              `/oauth/login?${params.toString()}`;

            urlService.openPopupWindow(oauthUrl);
          };

      const ret = open();

      if (ret instanceof Promise) {
        await ret;
      }
    },
    [urlService, redirectUrl, serverService, auth]
  );

  if (!oauth) {
    return null;
  }

  return oauthProviders?.map(provider => {
    return (
      <OAuthProvider
        key={provider}
        provider={provider}
        label={provider === OAuthProviderType.OIDC ? oidcButtonLabel : undefined}
        onContinue={onContinue}
      />
    );
  });
}

interface OauthProviderProps {
  provider: OAuthProviderType;
  /** 管理画面で設定した文言。未設定なら既定の "Continue with <provider>" */
  label?: string | null;
  onContinue: (provider: OAuthProviderType) => void;
}

function OAuthProvider({ onContinue, provider, label }: OauthProviderProps) {
  const { icon } =
    provider in OAuthProviderMap
      ? OAuthProviderMap[provider]
      : { icon: undefined };

  const onClick = useCallback(() => {
    onContinue(provider);
  }, [onContinue, provider]);

  return (
    <Button
      variant={provider === OAuthProviderType.Apple ? 'custom' : 'primary'}
      block
      size="extraLarge"
      style={{ width: '100%' }}
      prefix={icon}
      onClick={onClick}
    >
      {label || `Continue with ${provider}`}
    </Button>
  );
}
