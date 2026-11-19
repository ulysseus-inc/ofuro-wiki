import { test, expect, type Page } from '@playwright/test';
import {
  addToShared,
  createManagedSharedWorkspace,
  deleteWorkspaceAsAdmin,
  dismissDevOverlay,
  importSharedWorkspace,
  waitForWorkspaceInitialized,
} from './helpers';

/**
 * #299: **招待の通知が、実際に起きたことと合うこと。**
 *
 * 以前は「招待メールを送れたか」で成否を数えていた。メールの設定が無い環境では、
 * アカウントがある人をその場でメンバーに追加できていても、
 * 「0 が成功」「すでに招待されています」と出ていた。
 *
 * 準備は API で行い、検査したい操作（招待と通知）だけを画面で行う。
 * 詳細は docs/workspace-invitation.md 4.1
 */

const API = process.env.API_URL || 'http://localhost:3010';

const OWNER = {
  email: 'e2e-invres-owner@ofuro-wiki.local',
  password: 'E2eInvresOwner123!',
};
const MEMBER = {
  email: 'e2e-invres-member@ofuro-wiki.local',
  password: 'E2eInvresMember123!',
};

/** アカウントの無いアドレス（実行ごとに変える。招待の行は残るため） */
const nobody = () => `e2e-invres-nobody-${Date.now()}@ofuro-wiki.local`;

/**
 * sign-in（無ければ sign-up）して認証クッキーヘッダを返す。
 * ⚠️ 新規登録を閉じた環境（registration_open=false）では、初回の sign-up が通らず落ちる
 */
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
  return res.json();
}

/**
 * #297: 招待できるのは共有だけ。共有は管理者が作り、OWNER をワークスペース管理者にする
 * （今までの「所有者」の代わり。管理者は招待できる）。
 * 画面で開くものは、中身のあるワークスペースを取り込んで作る（API で作ると中身が空で開けない）。
 */
async function openSharedAsManager(page: Page, ownerCookie: string): Promise<string> {
  const wsId = await importSharedWorkspace(API, `e2e-invres-${Date.now()}`);
  await addToShared(API, wsId, ownerCookie, 'Admin');

  const res = await page.request.post('/api/auth/sign-in', {
    data: { email: OWNER.email, password: OWNER.password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok()).toBe(true);
  await page.goto(`/workspace/${wsId}/all`);
  await page.waitForURL(new RegExp(`/workspace/${wsId}`), { timeout: 30_000 });
  await dismissDevOverlay(page);
  await waitForWorkspaceInitialized(page);
  return wsId;
}

/**
 * 設定 → メンバー →「メンバーを招待」で招待し、出た通知を返す。
 * 通知の中だけを見る（メンバー一覧にも同じアドレスが出るため、画面全体で探すと取り違える）
 */
async function inviteFromSettings(page: Page, emails: string[]) {
  await page.locator('[data-testid="slider-bar-workspace-setting-button"]').click();
  await expect(page.locator('[data-testid="setting-modal"]')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-testid="workspace-setting:members"]').click();

  await page.getByRole('button', { name: 'メンバーを招待' }).click();
  await page.getByPlaceholder('メールアドレスを入力（カンマで区切る）').fill(emails.join(', '));
  await page.getByRole('button', { name: '招待を送る' }).click();

  // sonner の通知
  return page.locator('[data-sonner-toast]').last();
}

test.describe('招待の結果（#299）', () => {
  test('宛先ごとに、追加した・すでにメンバー・アカウントが無い、を返す', async () => {
    const ownerCookie = await authCookie(OWNER.email, OWNER.password);
    await authCookie(MEMBER.email, MEMBER.password);
    const wsId = await createManagedSharedWorkspace(API, ownerCookie, `e2e-invres-api-${Date.now()}`);
    const stranger = nobody();

    try {
      const r = await gql(
        ownerCookie,
        `mutation ($w: String!, $e: [String!]!) {
          inviteMembers(workspaceId: $w, emails: $e) { email outcome }
        }`,
        { w: wsId, e: [MEMBER.email, OWNER.email, stranger] },
      );
      expect(r.errors).toBeUndefined();

      const outcomeOf = (email: string) =>
        r.data.inviteMembers.find((x: { email: string }) => x.email === email)?.outcome;
      expect(outcomeOf(MEMBER.email)).toBe('Added');
      expect(outcomeOf(OWNER.email)).toBe('AlreadyMember');
      expect(outcomeOf(stranger)).toBe('Invited');
    } finally {
      await deleteWorkspaceAsAdmin(API, wsId);
    }
  });

  test('⚠️ アカウントがある人を招待すると、追加できたと通知する（失敗と出さない）', async ({
    page,
  }) => {
    const ownerCookie = await authCookie(OWNER.email, OWNER.password);
    await authCookie(MEMBER.email, MEMBER.password);
    // 毎回新しい共有なので、MEMBER はまだメンバーでない
    const wsId = await openSharedAsManager(page, ownerCookie);
    const stranger = nobody();

    try {
      const toast = await inviteFromSettings(page, [MEMBER.email, OWNER.email, stranger]);

      // 1 人を追加。所有者は「すでにメンバー」、知らない人は「アカウントが無い」
      await expect(toast).toContainText('1 人をメンバーに追加しました', { timeout: 10_000 });
      await expect(toast).toContainText('すでにメンバーです：');
      await expect(toast).toContainText(OWNER.email);
      await expect(toast).toContainText('アカウントがない');
      await expect(toast).toContainText(stranger);

      // ⚠️ 以前の誤った文言が出ないこと
      await expect(toast).not.toContainText('すでに招待されています');
      await expect(toast).not.toContainText('が失敗しました');
    } finally {
      await deleteWorkspaceAsAdmin(API, wsId);
    }
  });

  test('⚠️ 誰も増えないときは「0 人を追加しました」と出さない', async ({ page }) => {
    const ownerCookie = await authCookie(OWNER.email, OWNER.password);
    const wsId = await openSharedAsManager(page, ownerCookie);

    try {
      const toast = await inviteFromSettings(page, [OWNER.email]);

      await expect(toast).toContainText('メンバーは増えていません', { timeout: 10_000 });
      await expect(toast).toContainText('すでにメンバーです：');
      await expect(toast).not.toContainText('0 人');
    } finally {
      await deleteWorkspaceAsAdmin(API, wsId);
    }
  });
});
