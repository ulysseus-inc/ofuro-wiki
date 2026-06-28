jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  default: {},
  __esModule: true,
}));

import { UserResolver } from '../../../src/modules/user/user.resolver';

describe('UserResolver', () => {
  let resolver: UserResolver;
  let mockUserService: any;
  let mockNotificationService: any;

  beforeEach(() => {
    mockUserService = {
      findById: jest.fn(),
      updateUser: jest.fn(),
    };

    mockNotificationService = {
      getNotificationCount: jest.fn().mockResolvedValue(0),
    };

    resolver = new UserResolver(mockUserService, mockNotificationService);
  });

  describe('currentUser', () => {
    it('DBから通知設定を返す', async () => {
      mockUserService.findById.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test',
        avatarUrl: null,
        passwordHash: 'hash',
        emailVerified: true,
        isAdmin: false,
        receiveInvitationEmail: true,
        receiveMentionEmail: false,
        receiveCommentEmail: true,
        createdAt: new Date('2025-01-01'),
      });

      const result = await resolver.currentUser({ id: 'user-1' });

      expect(result!.settings).toEqual({
        receiveInvitationEmail: true,
        receiveMentionEmail: false,
        receiveCommentEmail: true,
      });
    });
  });

  describe('updateSettings', () => {
    it('通知設定を更新', async () => {
      mockUserService.updateUser.mockResolvedValue({});

      const result = await resolver.updateSettings(
        { id: 'user-1' },
        { receiveCommentEmail: true },
      );

      expect(result).toBe(true);
      expect(mockUserService.updateUser).toHaveBeenCalledWith('user-1', {
        receiveCommentEmail: true,
      });
    });

    it('複数設定を同時に更新', async () => {
      mockUserService.updateUser.mockResolvedValue({});

      const result = await resolver.updateSettings(
        { id: 'user-1' },
        {
          receiveInvitationEmail: true,
          receiveMentionEmail: true,
          receiveCommentEmail: false,
        },
      );

      expect(result).toBe(true);
      expect(mockUserService.updateUser).toHaveBeenCalledWith('user-1', {
        receiveInvitationEmail: true,
        receiveMentionEmail: true,
        receiveCommentEmail: false,
      });
    });

    it('空入力時はDB更新しない', async () => {
      const result = await resolver.updateSettings({ id: 'user-1' }, {});

      expect(result).toBe(true);
      expect(mockUserService.updateUser).not.toHaveBeenCalled();
    });
  });
});
