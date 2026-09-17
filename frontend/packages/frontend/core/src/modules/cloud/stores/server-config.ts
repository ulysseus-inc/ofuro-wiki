import {
  gqlFetcherFactory,
  type OauthProvidersQuery,
  oauthProvidersQuery,
  type ServerConfigQuery,
  serverConfigQuery,
  ServerFeature,
} from '@ofuro/graphql';
import { Store } from '@toeverything/infra';

export type ServerConfigType = ServerConfigQuery['serverConfig'] &
  OauthProvidersQuery['serverConfig'];

export class ServerConfigStore extends Store {
  constructor() {
    super();
  }

  async fetchServerConfig(
    serverBaseUrl: string,
    abortSignal?: AbortSignal
  ): Promise<ServerConfigType> {
    const gql = gqlFetcherFactory(`${serverBaseUrl}/graphql`, globalThis.fetch);
    const serverConfigData = await gql({
      query: serverConfigQuery,
      context: {
        signal: abortSignal,
        headers: {
          'x-affine-version': BUILD_CONFIG.appVersion,
        },
      },
    });
    if (serverConfigData.serverConfig.features.includes(ServerFeature.OAuth)) {
      const oauthProvidersData = await gql({
        query: oauthProvidersQuery,
        context: {
          signal: abortSignal,
          headers: {
            'x-affine-version': BUILD_CONFIG.appVersion,
          },
        },
      });
      return {
        ...serverConfigData.serverConfig,
        ...oauthProvidersData.serverConfig,
      };
    }
    // #210: oidcButtonLabel は oauthProviders と同じクエリで取る。取らないときは未設定（null）
    return {
      ...serverConfigData.serverConfig,
      oauthProviders: [],
      oidcButtonLabel: null,
    };
  }
}
