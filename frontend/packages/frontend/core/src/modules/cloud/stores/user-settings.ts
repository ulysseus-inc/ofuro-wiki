import {
  type GetCurrentUserProfileQuery,
  getCurrentUserProfileQuery,
  type UpdateUserSettingsInput,
  updateUserSettingsMutation,
} from '@ofuro/graphql';
import { Store } from '@toeverything/infra';

import type { GraphQLService } from '../services/graphql';

// #210: スキーマでは currentUser.settings は null を許す
export type UserSettings = NonNullable<
  NonNullable<GetCurrentUserProfileQuery['currentUser']>['settings']
>;

export type { UpdateUserSettingsInput };

export class UserSettingsStore extends Store {
  constructor(private readonly gqlService: GraphQLService) {
    super();
  }

  async getUserSettings(): Promise<UserSettings | undefined> {
    const result = await this.gqlService.gql({
      query: getCurrentUserProfileQuery,
    });
    // #210: スキーマでは settings は null を許す
    return result.currentUser?.settings ?? undefined;
  }

  async updateUserSettings(settings: UpdateUserSettingsInput) {
    await this.gqlService.gql({
      query: updateUserSettingsMutation,
      variables: {
        input: settings,
      },
    });
  }
}
