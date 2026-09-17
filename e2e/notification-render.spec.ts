import { test, expect, type Page } from '@playwright/test';
import {
  dismissDevOverlay,
  getOwnedWorkspaceId,
  waitForWorkspaceInitialized,
} from './helpers';

/**
 * #210: ⚠️ **通知一覧に、Mention / Comment / CommentMention が描画されること。**
 *
 * 通知一覧（components/notification/list.tsx）は、種類を列挙の値と比べて描画する部品を選ぶ:
 *
 *   type === NotificationType.Mention ? <Mention…/> : type === NotificationType.Comment ? …
 *
 * `schema.ts` を codegen の生成物にしたとき、列挙 `NotificationType` がスキーマに無いと、
 * 同名のオブジェクト型に入れ替わって `NotificationType.Mention` が `undefined` になり、
 * **比較がすべて偽になって、通知が1件も描画されない**（エラーは出ない。型エラーも1件前後）。
 *
 * 既存の通知の E2E（comment.spec.ts）は API で問い合わせるだけで、これを捕まえられない。
 *
 * 準備（参加・コメント・メンション）は API で行い、**描画だけを画面で確かめる**。
 * 詳細は docs/development.md「型（schema.ts）も codegen が生成する」
 */

const API = process.env.API_URL || 'http://localhost:3010';

/** 通知を受け取る人（自分宛てのメンションは通知を作らないため、送る人と分ける） */
const RECEIVER = {
  email: 'e2e-notif-receiver@ofuro-wiki.local',
  password: 'E2eNotifReceiver123!',
};
const SENDER = {
  email: 'e2e-notif-sender@ofuro-wiki.local',
  password: 'E2eNotifSender123!',
};

/** 種類ごとに、ページの題と、描画される文言（ja.json の com.affine.notification.*） */
const CASES = {
  comment: { title: 'e2e210-comment', phrase: 'にコメントしました' },
  commentMention: { title: 'e2e210-comment-mention', phrase: 'のコメントであなたに言及しました' },
  mention: { title: 'e2e210-mention', phrase: 'であなたを言及しました' },
} as const;

/** sign-in（無ければ sign-up）して認証クッキーヘッダを返す */
async function authCookie(email: string, password: string): Promise<string> {
  let res = await fetch(`${API}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status === 401 || res.status === 404) {
    res = await fetch(`${API}/api/auth/sign-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  }
  if (!res.ok) {
    throw new Error(`auth failed for ${email}: ${res.status} ${await res.text()}`);
  }
  const cookies = res.headers.getSetCookie?.() ?? [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function gql(cookie: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  expect(json.errors, JSON.stringify(json.errors)).toBeUndefined();
  return json.data;
}

/** ブラウザで指定のユーザーとしてサインインし、自分のワークスペース（無ければ作られる）を開く */
async function openOwnWorkspaceAs(page: Page, user: typeof RECEIVER) {
  const res = await page.request.post('/api/auth/sign-in', {
    data: { email: user.email, password: user.password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok()).toBe(true);

  await page.goto('/');
  await page.waitForURL(/\/workspace\//, { timeout: 30_000 });
  await dismissDevOverlay(page);
  // ⚠️ 中身の書き込みが終わるまで待つ。途中で離れると中身の無いワークスペースが残る
  await waitForWorkspaceInitialized(page);
}

test.describe('通知一覧の描画（#210）', () => {
  test('⚠️ Mention / Comment / CommentMention が通知一覧に描画される', async ({ page }) => {
    const receiverCookie = await authCookie(RECEIVER.email, RECEIVER.password);
    const senderCookie = await authCookie(SENDER.email, SENDER.password);

    // --- 準備: 受け取る人のワークスペース（画面で作らせる。API では中身が作られない）
    await openOwnWorkspaceAs(page, RECEIVER);
    const wsId = await getOwnedWorkspaceId(page);
    expect(wsId).toBeTruthy();
    if (!wsId) {
      return;
    }

    try {
      // --- 準備: 送る人を参加させる
      const invited = await gql(
        receiverCookie,
        `mutation ($w: String!, $e: [String!]!) { inviteMembers(workspaceId: $w, emails: $e) { inviteId } }`,
        { w: wsId, e: [SENDER.email] },
      );
      await gql(
        senderCookie,
        `mutation ($w: String!, $i: String!) { acceptInviteById(workspaceId: $w, inviteId: $i) }`,
        { w: wsId, i: invited.inviteMembers[0].inviteId },
      );

      const receiverId: string = (await gql(receiverCookie, `{ currentUser { id } }`)).currentUser.id;
      await gql(receiverCookie, `mutation { readAllNotifications }`);

      // --- Comment: 受け取る人のコメントに、送る人が返信する
      const comment = await gql(
        receiverCookie,
        `mutation ($input: CommentCreateInput!) { createComment(input: $input) { id } }`,
        {
          input: {
            workspaceId: wsId,
            docId: 'e2e210-doc',
            docMode: 'page',
            docTitle: CASES.comment.title,
            content: { text: 'receiver comment' },
          },
        },
      );
      await gql(
        senderCookie,
        `mutation ($input: ReplyCreateInput!) { createReply(input: $input) { id } }`,
        {
          input: {
            commentId: comment.createComment.id,
            docMode: 'page',
            docTitle: CASES.comment.title,
            content: { text: 'sender reply' },
          },
        },
      );

      // --- CommentMention: 送る人が、受け取る人をメンションしたコメントを作る
      await gql(
        senderCookie,
        `mutation ($input: CommentCreateInput!) { createComment(input: $input) { id } }`,
        {
          input: {
            workspaceId: wsId,
            docId: 'e2e210-doc',
            docMode: 'page',
            docTitle: CASES.commentMention.title,
            content: { text: 'sender mentions receiver' },
            mentions: [receiverId],
          },
        },
      );

      // --- Mention: 送る人が、受け取る人をメンションする
      const mentioned = await gql(
        senderCookie,
        `mutation ($input: MentionInput!) { mentionUser(input: $input) }`,
        {
          input: {
            userId: receiverId,
            workspaceId: wsId,
            doc: { id: 'e2e210-doc', title: CASES.mention.title, mode: 'page' },
          },
        },
      );
      expect(mentioned.mentionUser).toBe(true);

      // --- 画面: 受け取る人が通知一覧を開く（最新の通知を取り直すため、開き直す）
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForWorkspaceInitialized(page);
      await page.locator('[data-testid="notification-button"]').click();

      // ⚠️ 種類ごとに、その題とその種類の文言が「同じ行」にあること。
      // 列挙の比較が偽になると、どの行も描画されない
      for (const { title, phrase } of Object.values(CASES)) {
        await expect(
          page.locator('span', { hasText: title }).filter({ hasText: phrase }).first(),
        ).toBeVisible({ timeout: 15_000 });
      }
    } finally {
      // 後片付け: ワークスペースごと消す（通知・コメントも消える）
      await gql(receiverCookie, `mutation ($id: String!) { deleteWorkspace(id: $id) }`, { id: wsId });
    }
  });
});
