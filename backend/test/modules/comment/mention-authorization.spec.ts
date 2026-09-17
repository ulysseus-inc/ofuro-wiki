jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  default: {},
  __esModule: true,
}));

import { CommentService } from '../../../src/modules/comment/comment.service';
import { CommentMutationResolver } from '../../../src/modules/comment/comment.resolver';

/**
 * #223: ⚠️ **メンションは、同じワークスペースのメンバーで、ページを読める人の間だけ。**
 *
 * 以前はログインしているかしか見ておらず、API を直接呼べば誰でも、任意のユーザーに
 * タイトルを偽った通知とメールを送れた（docs/mention-notification.md）。
 *
 * | 利用者 | WS | ページ |
 * |---|---|---|
 * | author  | member | 読める |
 * | reader  | member | 読める |
 * | blocked | member | 読めない（#97 のページ単位の制限） |
 * | outsider| なし   | 読めない |
 * | admin   | なし   | 読める（サーバー全体 Admin は getDocRole を素通りする） |
 */
const WS = 'ws-1';
const DOC = 'doc-1';
const REAL_TITLE = '本当の題';
const FAKE_TITLE = '偽の題';

const ROLES: Record<string, string | null> = {
  author: 'member',
  reader: 'member',
  blocked: 'member',
  outsider: null,
  admin: null,
};
const READABLE = new Set(['author', 'reader', 'admin']);

describe('メンションの認可（#223）', () => {
  let service: CommentService;
  let resolver: CommentMutationResolver;
  let mockPrisma: any;
  let mockNotification: any;

  beforeEach(() => {
    mockPrisma = {
      docMeta: {
        findUnique: jest.fn().mockResolvedValue({ title: REAL_TITLE }),
      },
      comment: {
        create: jest.fn().mockResolvedValue({
          id: 'c-1',
          content: {},
          resolved: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { id: 'author', name: 'A', avatarUrl: null },
          replies: [],
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'c-1',
          workspaceId: WS,
          docId: DOC,
          userId: 'reader',
        }),
      },
      reply: {
        create: jest.fn().mockResolvedValue({
          id: 'r-1',
          commentId: 'c-1',
          content: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { id: 'author', name: 'A', avatarUrl: null },
        }),
      },
    };

    const mockPermission = {
      getWorkspaceRole: jest.fn(
        async (_ws: string, userId: string) => ROLES[userId] ?? null,
      ),
      canRead: jest.fn(async (_ws: string, _doc: string, userId: string) =>
        READABLE.has(userId),
      ),
    };

    mockNotification = {
      createMentionNotification: jest.fn().mockResolvedValue(undefined),
      createCommentMentionNotification: jest.fn().mockResolvedValue(undefined),
      createCommentNotification: jest.fn().mockResolvedValue(undefined),
    };

    service = new CommentService(mockPrisma, mockPermission as any);
    resolver = new CommentMutationResolver(
      service,
      mockNotification,
      {} as any,
    );
  });

  const mentionInput = (userId: string) => ({
    userId,
    workspaceId: WS,
    doc: { id: DOC, title: FAKE_TITLE, mode: 'page' },
  });

  describe('mentionUser（本文の @）', () => {
    it('⚠️ ワークスペースのメンバーでない人は送れない', async () => {
      await expect(
        resolver.mentionUser({ id: 'outsider' }, mentionInput('reader')),
      ).rejects.toThrow();
      expect(mockNotification.createMentionNotification).not.toHaveBeenCalled();
    });

    it('⚠️ ページを読めない人は送れない', async () => {
      await expect(
        resolver.mentionUser({ id: 'blocked' }, mentionInput('reader')),
      ).rejects.toThrow();
      expect(mockNotification.createMentionNotification).not.toHaveBeenCalled();
    });

    it('⚠️ ページを読めない相手には送らない（MENTION_USER_DOC_ACCESS_DENIED）', async () => {
      await expect(
        resolver.mentionUser({ id: 'author' }, mentionInput('blocked')),
      ).rejects.toThrow('MENTION_USER_DOC_ACCESS_DENIED');
      expect(mockNotification.createMentionNotification).not.toHaveBeenCalled();
    });

    it('⚠️ ワークスペースのメンバーでない相手には送らない（Admin でページを読めても）', async () => {
      await expect(
        resolver.mentionUser({ id: 'author' }, mentionInput('admin')),
      ).rejects.toThrow('MENTION_USER_DOC_ACCESS_DENIED');
      expect(mockNotification.createMentionNotification).not.toHaveBeenCalled();
    });

    it('⚠️ 通知のタイトルは台帳から取る（送る側の値は使わない）', async () => {
      await resolver.mentionUser({ id: 'author' }, mentionInput('reader'));

      expect(mockNotification.createMentionNotification).toHaveBeenCalledWith(
        'author',
        'reader',
        WS,
        expect.objectContaining({ id: DOC, title: REAL_TITLE }),
      );
    });

    it('台帳に行が無いページは、タイトルを空にする', async () => {
      mockPrisma.docMeta.findUnique.mockResolvedValue(null);

      await resolver.mentionUser({ id: 'author' }, mentionInput('reader'));

      expect(mockNotification.createMentionNotification).toHaveBeenCalledWith(
        'author',
        'reader',
        WS,
        expect.objectContaining({ title: '' }),
      );
    });
  });

  describe('createComment の mentions', () => {
    const commentInput = (mentions: string[]) => ({
      workspaceId: WS,
      docId: DOC,
      docMode: 'page',
      docTitle: FAKE_TITLE,
      content: {},
      mentions,
    });

    it('⚠️ ページを読めない人はコメントできない', async () => {
      await expect(
        resolver.createComment({ id: 'blocked' }, commentInput(['reader'])),
      ).rejects.toThrow();
      expect(mockPrisma.comment.create).not.toHaveBeenCalled();
      expect(
        mockNotification.createCommentMentionNotification,
      ).not.toHaveBeenCalled();
    });

    it('⚠️ 読めない相手・メンバーでない相手には送らず、読める相手には台帳の題で送る', async () => {
      await resolver.createComment(
        { id: 'author' },
        commentInput(['reader', 'blocked', 'outsider', 'admin']),
      );

      const calls =
        mockNotification.createCommentMentionNotification.mock.calls;
      expect(calls.map((c: any[]) => c[1])).toEqual(['reader']);
      expect(calls[0][3]).toEqual(
        expect.objectContaining({ id: DOC, title: REAL_TITLE }),
      );
    });
  });

  describe('createReply', () => {
    const replyInput = (mentions: string[]) => ({
      commentId: 'c-1',
      content: {},
      docMode: 'page',
      docTitle: FAKE_TITLE,
      mentions,
    });

    it('⚠️ ページを読めない人は返信できない', async () => {
      await expect(
        resolver.createReply({ id: 'blocked' }, replyInput([])),
      ).rejects.toThrow();
      expect(mockPrisma.reply.create).not.toHaveBeenCalled();
    });

    it('⚠️ 親コメントの作者への通知も、台帳の題で送る', async () => {
      await resolver.createReply({ id: 'author' }, replyInput([]));

      expect(mockNotification.createCommentNotification).toHaveBeenCalledWith(
        'author',
        'reader',
        WS,
        expect.objectContaining({ id: DOC, title: REAL_TITLE }),
      );
    });

    it('⚠️ 親コメントの作者がページを読めなくなっていたら送らない', async () => {
      mockPrisma.comment.findUnique.mockResolvedValue({
        id: 'c-1',
        workspaceId: WS,
        docId: DOC,
        userId: 'blocked',
      });

      await resolver.createReply({ id: 'author' }, replyInput([]));

      expect(mockNotification.createCommentNotification).not.toHaveBeenCalled();
    });

    it('⚠️ mentions は読める相手にだけ、台帳の題で送る', async () => {
      await resolver.createReply(
        { id: 'author' },
        replyInput(['reader', 'blocked', 'outsider']),
      );

      const calls =
        mockNotification.createCommentMentionNotification.mock.calls;
      expect(calls.map((c: any[]) => c[1])).toEqual(['reader']);
      expect(calls[0][3]).toEqual(
        expect.objectContaining({ title: REAL_TITLE }),
      );
    });
  });
});
