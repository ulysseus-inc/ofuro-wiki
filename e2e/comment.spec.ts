/**
 * コメント・通知機能 E2E テスト
 *
 * 前提条件:
 *   - PostgreSQL が起動済み (docker compose up -d)
 *   - バックエンド (port 3010) が起動済み (cd backend && npm run start:dev)
 *
 * 実行方法:
 *   cd e2e && npx playwright test comment.spec.ts
 */
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { TEST_USER, ensureTestUser, signIn, graphqlQuery, enterOrCreateWorkspace } from './helpers';

const test = base.extend<
  { sharedPage: Page },
  { sharedContext: BrowserContext; workerPage: Page }
>({
  sharedContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  workerPage: [
    async ({ sharedContext }, use) => {
      const page = await sharedContext.newPage();
      page.on('domcontentloaded', async () => {
        await page
          .addStyleTag({
            content:
              '#webpack-dev-server-client-overlay { pointer-events: none !important; display: none !important; }',
          })
          .catch(() => {});
      });
      await use(page);
      await page.close();
    },
    { scope: 'worker' },
  ],
  sharedPage: async ({ workerPage }, use) => {
    await use(workerPage);
  },
});

test.describe.configure({ mode: 'serial' });

let workspaceId: string;
let commentId: string;
let replyId: string;

test.beforeAll(async () => {
  await ensureTestUser('http://localhost:3010');
});

test('セットアップ: サインインしてワークスペースIDを取得', async ({ sharedPage }) => {
  await signIn(sharedPage);
  await enterOrCreateWorkspace(sharedPage);
  const result = await graphqlQuery(sharedPage, '{ workspaces { id } }');
  workspaceId = result.data.workspaces[0].id;
  expect(workspaceId).toBeTruthy();
});

test('コメントを作成できる', async ({ sharedPage }) => {
  const result = await graphqlQuery(
    sharedPage,
    `mutation createComment($input: CommentCreateInput!) {
      createComment(input: $input) {
        id
        content
        resolved
        createdAt
        updatedAt
        user { id name avatarUrl }
        replies { id }
      }
    }`,
    {
      input: {
        workspaceId,
        docId: 'test-doc-1',
        docMode: 'page',
        docTitle: 'Test Document',
        content: { text: 'Hello, this is a test comment' },
      },
    },
  );
  expect(result.errors).toBeUndefined();
  expect(result.data.createComment.id).toBeTruthy();
  expect(result.data.createComment.content).toEqual({
    text: 'Hello, this is a test comment',
  });
  expect(result.data.createComment.resolved).toBe(false);
  expect(result.data.createComment.replies).toEqual([]);
  commentId = result.data.createComment.id;
});

test('コメント一覧を取得できる', async ({ sharedPage }) => {
  const result = await graphqlQuery(
    sharedPage,
    `query listComments($workspaceId: String!, $docId: String!) {
      workspace(id: $workspaceId) {
        comments(docId: $docId) {
          totalCount
          edges {
            cursor
            node {
              id content resolved
              user { id name avatarUrl }
              replies { id }
            }
          }
          pageInfo { hasNextPage hasPreviousPage }
        }
      }
    }`,
    { workspaceId, docId: 'test-doc-1' },
  );
  expect(result.errors).toBeUndefined();
  expect(result.data.workspace.comments.totalCount).toBeGreaterThanOrEqual(1);
  const found = result.data.workspace.comments.edges.find(
    (e: any) => e.node.id === commentId,
  );
  expect(found).toBeTruthy();
});

test('コメントを更新できる', async ({ sharedPage }) => {
  const result = await graphqlQuery(
    sharedPage,
    `mutation updateComment($input: CommentUpdateInput!) {
      updateComment(input: $input)
    }`,
    {
      input: {
        id: commentId,
        content: { text: 'Updated comment text' },
      },
    },
  );
  expect(result.errors).toBeUndefined();
  expect(result.data.updateComment).toBe(true);
});

test('コメントに返信できる', async ({ sharedPage }) => {
  const result = await graphqlQuery(
    sharedPage,
    `mutation createReply($input: ReplyCreateInput!) {
      createReply(input: $input) {
        id commentId content createdAt updatedAt
        user { id name avatarUrl }
      }
    }`,
    {
      input: {
        commentId,
        content: { text: 'This is a reply' },
        docMode: 'page',
        docTitle: 'Test Document',
      },
    },
  );
  expect(result.errors).toBeUndefined();
  expect(result.data.createReply.id).toBeTruthy();
  expect(result.data.createReply.commentId).toBe(commentId);
  expect(result.data.createReply.content).toEqual({
    text: 'This is a reply',
  });
  replyId = result.data.createReply.id;
});

test('コメントを解決（resolve）できる', async ({ sharedPage }) => {
  const result = await graphqlQuery(
    sharedPage,
    `mutation resolveComment($input: CommentResolveInput!) {
      resolveComment(input: $input)
    }`,
    { input: { id: commentId, resolved: true } },
  );
  expect(result.errors).toBeUndefined();
  expect(result.data.resolveComment).toBe(true);

  // Verify it's resolved
  const check = await graphqlQuery(
    sharedPage,
    `query ($workspaceId: String!, $docId: String!) {
      workspace(id: $workspaceId) {
        comments(docId: $docId) {
          edges { node { id resolved } }
        }
      }
    }`,
    { workspaceId, docId: 'test-doc-1' },
  );
  const resolvedComment = check.data.workspace.comments.edges.find(
    (e: any) => e.node.id === commentId,
  );
  expect(resolvedComment.node.resolved).toBe(true);
});

test('返信を削除できる', async ({ sharedPage }) => {
  const result = await graphqlQuery(
    sharedPage,
    `mutation deleteReply($id: String!) { deleteReply(id: $id) }`,
    { id: replyId },
  );
  expect(result.errors).toBeUndefined();
  expect(result.data.deleteReply).toBe(true);
});

test('コメントを削除できる', async ({ sharedPage }) => {
  const result = await graphqlQuery(
    sharedPage,
    `mutation deleteComment($id: String!) { deleteComment(id: $id) }`,
    { id: commentId },
  );
  expect(result.errors).toBeUndefined();
  expect(result.data.deleteComment).toBe(true);

  // Verify it's gone
  const check = await graphqlQuery(
    sharedPage,
    `query ($workspaceId: String!, $docId: String!) {
      workspace(id: $workspaceId) {
        comments(docId: $docId) {
          edges { node { id } }
        }
      }
    }`,
    { workspaceId, docId: 'test-doc-1' },
  );
  const found = check.data.workspace.comments.edges.find(
    (e: any) => e.node.id === commentId,
  );
  expect(found).toBeUndefined();
});

test('通知一覧を取得できる', async ({ sharedPage }) => {
  const result = await graphqlQuery(
    sharedPage,
    `query listNotifications($pagination: PaginationInput!) {
      currentUser {
        notifications(pagination: $pagination) {
          totalCount
          edges {
            cursor
            node { id type level read body createdAt updatedAt }
          }
          pageInfo { hasNextPage hasPreviousPage }
        }
      }
    }`,
    { pagination: { first: 10 } },
  );
  expect(result.errors).toBeUndefined();
  expect(result.data.currentUser.notifications).toBeTruthy();
  expect(result.data.currentUser.notifications.totalCount).toBeGreaterThanOrEqual(0);
});

test('通知を全て既読にできる', async ({ sharedPage }) => {
  const result = await graphqlQuery(
    sharedPage,
    `mutation { readAllNotifications }`,
  );
  expect(result.errors).toBeUndefined();
  expect(result.data.readAllNotifications).toBe(true);
});

test('メンション通知が生成される', async ({ sharedPage }) => {
  // Get current user ID
  const userResult = await graphqlQuery(
    sharedPage,
    `query { currentUser { id } }`,
  );
  const userId = userResult.data.currentUser.id;

  const result = await graphqlQuery(
    sharedPage,
    `mutation mentionUser($input: MentionInput!) {
      mentionUser(input: $input)
    }`,
    {
      input: {
        userId,
        workspaceId,
        doc: {
          id: 'test-doc-1',
          title: 'Test Document',
          mode: 'page',
        },
      },
    },
  );
  expect(result.errors).toBeUndefined();
  expect(result.data.mentionUser).toBe(true);
});
