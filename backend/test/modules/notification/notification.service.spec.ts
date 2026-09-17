import { NotificationService } from '../../../src/modules/notification/notification.service';
import { flushAsync, waitForCall } from '../../helpers/wait-for';

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

  /**
   * #210: ⚠️ **知らない種類の通知は一覧から外す。**
   *
   * 通知の `type` は GraphQL の列挙 `NotificationType` で返す。DB の列はただの文字列なので、
   * 列挙に無い値が1行でもあると GraphQL が変換できず、**通知の一覧が丸ごと失敗する**。
   * 1件のために一覧全体を壊さない。
   */
  /**
   * ⚠️ **外すのは DB の問い合わせの条件で行うこと**（#218 のレビュー指摘・Codex P1）。
   *
   * 取ったあとで外すと、1ページ分がすべて知らない種類のとき、一覧は空なのに
   * 「次のページあり」になり、次の位置（endCursor）が無い。フロントは先頭を取り直すので、
   * **同じページを繰り返し、その先の通知に届かない**。件数も外す前の数になり、
   * バッジと一覧が食い違う。
   *
   * ここでは Prisma を、条件（userId・type.in・read・cursor）どおりに絞る小さな DB に差し替える。
   */
  describe('listNotifications の種類（#210）', () => {
    type Row = {
      id: string;
      userId: string;
      type: string;
      level: string;
      read: boolean;
      body: object;
      createdAt: Date;
      updatedAt: Date;
    };

    /** 新しい順に並ぶよう、後ろほど古い時刻にする */
    const rows = (types: string[]): Row[] =>
      types.map((type, i) => ({
        id: `n${i + 1}`,
        userId: 'user-1',
        type,
        level: 'Default',
        read: false,
        body: {},
        createdAt: new Date(Date.UTC(2026, 8, 12, 0, 0, 100 - i)),
        updatedAt: new Date(Date.UTC(2026, 8, 12, 0, 0, 100 - i)),
      }));

    /** where（userId・read・type.in）に合う行 */
    const matches = (r: Row, where: any) =>
      r.userId === where.userId &&
      (where.read === undefined || r.read === where.read) &&
      (where.type?.in === undefined || where.type.in.includes(r.type));

    const useDb = (data: Row[]) => {
      mockPrisma.notification.count.mockImplementation(async ({ where }: any) =>
        data.filter((r) => matches(r, where)).length,
      );
      mockPrisma.notification.findMany.mockImplementation(
        async ({ where, take, cursor, skip }: any) => {
          let list = data
            .filter((r) => matches(r, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          if (cursor) {
            const at = list.findIndex((r) => r.id === cursor.id);
            list = list.slice(at + (skip ?? 0));
          }
          return list.slice(0, take);
        },
      );
    };

    /** 知っている種類の通知が、先頭の1ページ分（2件）の知らない種類のあとに並ぶ */
    const UNKNOWN_FIRST = rows(['Unknown1', 'Unknown2', 'Mention', 'Comment', 'CommentMention']);

    it('⚠️ 1ページ分が知らない種類でも、知っている種類の通知が返り、次の位置をたどれる', async () => {
      useDb(UNKNOWN_FIRST);

      const page1 = await service.listNotifications('user-1', { first: 2 });
      expect(page1.edges.map((e) => e.node.id)).toEqual(['n3', 'n4']);
      expect(page1.pageInfo.hasNextPage).toBe(true);
      expect(page1.pageInfo.endCursor).toBe('n4');

      const page2 = await service.listNotifications('user-1', {
        first: 2,
        after: page1.pageInfo.endCursor,
      });
      expect(page2.edges.map((e) => e.node.id)).toEqual(['n5']);
      expect(page2.pageInfo.hasNextPage).toBe(false);
    });

    it('⚠️ 件数は、知っている種類だけを数える（一覧と食い違わない）', async () => {
      useDb(UNKNOWN_FIRST);

      const result = await service.listNotifications('user-1', { first: 50 });

      expect(result.totalCount).toBe(3);
      expect(result.edges).toHaveLength(3);
    });

    it('⚠️ 未読のバッジの件数も、知っている種類だけを数える', async () => {
      useDb(UNKNOWN_FIRST);

      await expect(service.getNotificationCount('user-1')).resolves.toBe(3);
    });
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

      // 撃ちっぱなしのメール送信を待つ（固定スリープは負荷で不安定になる / #139）
      await waitForCall(mockMailService.sendCommentNotificationEmail, 'メールが送信されなかった');

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
      // 否定形なので呼び出しは待てない。保留中の非同期処理を流しきってから確認する
      await flushAsync();

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

      await waitForCall(mockMailService.sendMentionNotificationEmail, 'メールが送信されなかった');

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

      await waitForCall(mockMailService.sendMentionNotificationEmail, 'メールが送信されなかった');

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
      // 否定形なので呼び出しは待てない。保留中の非同期処理を流しきってから確認する
      await flushAsync();

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
      await waitForCall(mockMailService.sendCommentNotificationEmail, 'メールが送信されなかった');

      expect(mockMailService.sendCommentNotificationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          contentPreview: 'あ'.repeat(200) + '...',
        }),
      );
    });
  });
});
