import type {
  CredentialsRequirementType,
  OAuthProviderType,
  ServerDeploymentType,
  ServerFeature,
} from '@ofuro/graphql';

export interface ServerMetadata {
  id: string;

  baseUrl: string;
}

export interface ServerConfig {
  serverName: string;
  features: ServerFeature[];
  oauthProviders: OAuthProviderType[];
  /** #89: SSO ボタンの表示文言（管理画面で設定。未設定なら既定文言） */
  oidcButtonLabel?: string | null;
  type: ServerDeploymentType;
  initialized?: boolean;
  version?: string;
  credentialsRequirement: CredentialsRequirementType;
}
