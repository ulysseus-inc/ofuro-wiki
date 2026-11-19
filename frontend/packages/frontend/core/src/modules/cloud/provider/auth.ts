import { createIdentifier } from '@toeverything/infra';

export interface AuthProvider {
  signInMagicLink(
    email: string,
    token: string,
    clientNonce?: string
  ): Promise<void>;

  signInOauth(
    code: string,
    state: string,
    provider: string,
    clientNonce?: string
  ): Promise<{ redirectUri?: string }>;

  signInPassword(credential: {
    email: string;
    password: string;
    verifyToken?: string;
    challenge?: string;
    /** #293: 「作りますか」で承認した。無ければサーバーは作らない */
    create?: boolean;
    /** #195: 招待のページから来た */
    inviteId?: string;
  }): Promise<void>;

  signOut(): Promise<void>;
}

export const AuthProvider = createIdentifier<AuthProvider>('AuthProvider');
