import {
  OAuthProviderType,
  ServerDeploymentType,
  ServerFeature,
} from '@ofuro/graphql';

import type { ServerConfig, ServerMetadata } from './types';

// ofuro-wiki: Removed Copilot/CopilotEmbedding features and AFFiNE Cloud URLs.
// Kept BUILD_CONFIG.debug branch structure for dev/E2E compatibility.
export const BUILD_IN_SERVERS: (ServerMetadata & { config: ServerConfig })[] =
  environment.isSelfHosted
    ? [
        {
          id: 'ofuro-cloud',
          baseUrl: location.origin,
          config: {
            serverName: 'ofuro-wiki',
            features: [],
            oauthProviders: [],
            type: ServerDeploymentType.Selfhosted,
            credentialsRequirement: {
              password: {
                minLength: 8,
                maxLength: 32,
              },
            },
          },
        },
      ]
    : BUILD_CONFIG.debug
      ? [
          {
            id: 'ofuro-cloud',
            baseUrl: BUILD_CONFIG.isElectron
              ? 'http://localhost:8080'
              : location.origin,
            config: {
              serverName: 'ofuro-wiki',
              features: [
                ServerFeature.Indexer,
                ServerFeature.OAuth,
                ServerFeature.Payment,
                ServerFeature.LocalWorkspace,
              ],
              oauthProviders: [
                OAuthProviderType.Google,
                OAuthProviderType.Apple,
              ],
              type: ServerDeploymentType.Affine,
              credentialsRequirement: {
                password: {
                  minLength: 8,
                  maxLength: 32,
                },
              },
            },
          },
        ]
      : [
          {
            id: 'ofuro-cloud',
            baseUrl: location.origin,
            config: {
              serverName: 'ofuro-wiki',
              features: [
                ServerFeature.Indexer,
                ServerFeature.OAuth,
                ServerFeature.Payment,
                ServerFeature.LocalWorkspace,
              ],
              oauthProviders: [
                OAuthProviderType.Google,
                OAuthProviderType.Apple,
              ],
              type: ServerDeploymentType.Affine,
              credentialsRequirement: {
                password: {
                  minLength: 8,
                  maxLength: 32,
                },
              },
            },
          },
        ];
