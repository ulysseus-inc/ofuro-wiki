import { NotificationService } from '../../../src/modules/notification/notification.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockPrisma: any;
  let mockMailService: any;

  const mockDoc = {
    id: 'doc-1',
    title: 'テストドキュメント',
    mode: 'page',
    blockId: 'block-1',
    elementId: undefined,
  };

  beforeEach(() => {
    mockPrisma = {
      notification: {
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn(),
      },
      workspace: {
        findUnique: jest.fn(),
      },
      searchIndex: {
        findFirst: jest.fn(),
      },
    };

    mockMailService = {
      isEnabled: jest.fn().mockReturnValue(true),
      sendCommentNotificationEmail: jest.fn().mockResolvedValue(undefined),
      sendMentionNotificationEmail: jest.fn().mockResolvedValue(undefined),
    };

    service = new NotificationService(mockPrisma, mockMailService);
  });

  describe('createCommentNotification', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'actor-1', name: 'Actor', avatarUrl: null }) // getActorInfo
        .mockResolvedValueOnce({ // sendNotificationEmail - target user
          email: 'target@example.com',
          receiveCommentEmail: true,
          receiveMentionEmail: false,
        });
      mockPrisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1', name: 'TestWS', avatarKey: null,
      });
      mockPrisma.searchIndex.findFirst.mockResolvedValue({
        content: 'ドキュメントの本文テキスト',
      });
    });

    it('通知作成後にメールを送信', async () => {
      await service.createCommentNotification('actor-1', 'target-1', 'ws-1', mockDoc);

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'Comment' }),
      });

      // Wait for async email sending
      await new Promise((r) => setTimeout(r, 50));

      expect(mockMailService.sendCommentNotificationEmail).toHaveBeenCalledWith({
        recipientEmail: 'target@example.com',
        actorName: 'Actor',
        workspaceName: 'TestWS',
        docTitle: 'テストドキュメント',
        contentPreview: 'ドキュメントの本文テキスト',
        docUrl: expect.stringContaining('ws-1/doc-1'),
      });
    });

    it('receiveCommentEmail=falseの場合メール送信しない', async () => {
      mockPrisma.user.findUnique
        .mockReset()
        .mockResolvedValueOnce({ id: 'actor-1', name: 'Actor', avatarUrl: null })
        .mockResolvedValueOnce({
          email: 'target@example.com',
          receiveCommentEmail: false,
          receiveMentionEmail: false,
        });

      await service.createCommentNotification('actor-1', 'target-1', 'ws-1', mockDoc);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockMailService.sendCommentNotificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('createMentionNotification', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'actor-1', name: 'Actor', avatarUrl: null })
        .mockResolvedValueOnce({
          email: 'target@example.com',
          receiveCommentEmail: false,
          receiveMentionEmail: true,
        });
      mockPrisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1', name: 'TestWS', avatarKey: null,
      });
      mockPrisma.searchIndex.findFirst.mockResolvedValue({ content: 'Preview text' });
    });

    it('メンション通知後にメール送信', async () => {
      await service.createMentionNotification('actor-1', 'target-1', 'ws-1', mockDoc);

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'Mention' }),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockMailService.sendMentionNotificationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientEmail: 'target@example.com',
          actorName: 'Actor',
        }),
      );
    });
  });

  describe('createCommentMentionNotification', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'actor-1', name: 'Actor', avatarUrl: null })
        .mockResolvedValueOnce({
          email: 'target@example.com',
          receiveCommentEmail: true,
          receiveMentionEmail: true,
        });
      mockPrisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1', name: 'TestWS', avatarKey: null,
      });
      mockPrisma.searchIndex.findFirst.mockResolvedValue({ content: 'Preview' });
    });

    it('コメントメンション通知でメンションメール送信', async () => {
      await service.createCommentMentionNotification('actor-1', 'target-1', 'ws-1', mockDoc);

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'CommentMention' }),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockMailService.sendMentionNotificationEmail).toHaveBeenCalled();
    });
  });

  describe('メール無効時', () => {
    it('mailService無効時はメール送信しない', async () => {
      mockMailService.isEnabled.mockReturnValue(false);
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'actor-1', name: 'Actor', avatarUrl: null,
      });
      mockPrisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1', name: 'TestWS', avatarKey: null,
      });

      await service.createCommentNotification('actor-1', 'target-1', 'ws-1', mockDoc);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockMailService.sendCommentNotificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('contentPreview', () => {
    it('200文字を超える場合は切り詰める', async () => {
      const longContent = 'あ'.repeat(250);
      mockPrisma.searchIndex.findFirst.mockResolvedValue({ content: longContent });
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'actor-1', name: 'Actor', avatarUrl: null })
        .mockResolvedValueOnce({
          email: 'target@example.com',
          receiveCommentEmail: true,
          receiveMentionEmail: false,
        });
      mockPrisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1', name: 'TestWS', avatarKey: null,
      });

      await service.createCommentNotification('actor-1', 'target-1', 'ws-1', mockDoc);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockMailService.sendCommentNotificationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          contentPreview: 'あ'.repeat(200) + '...',
        }),
      );
    });
  });
});
