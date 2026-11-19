import { test, expect, type Page } from '@playwright/test';
import {
  adminCookieFor,
  deleteWorkspaceAsAdmin,
  dismissDevOverlay,
  ensureTestUser,
  importSharedWorkspace,
  TEST_USER,
  waitForWorkspaceInitialized,
} from './helpers';

/**
 * M3: サインインと登録（docs/signin-registration.md）
 *
 * ⚠️ 「閉じた環境」のテストは、新規登録を閉じてから必ず開け直す（開発環境の設定を変えるため）。
 * workers: 1 なので、閉じている間にほかのテストがサインアップすることはない。
 */
const BASE = process.env.BASE_URL || 'http://localhost:8080';
const API = process.env.API_URL || 'http://localhost:3010';
const PASSWORD = 'E2eRegister#2026';

function uniqueEmail(label: string) {
  return `e2e-m3-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** サインインの API（画面と同じ経路）。応答の status と name を返す */
async function signInApi(body: Record<string, unknown>) {
  const res = await fetch(`${API}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, name: json.name as string | undefined };
}

async function gql(cookie: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function setRegistrationOpen(admin: string, open: boolean) {
  const result = await gql(
    admin,
    `mutation ($v: String!) { adminUpdateServerSetting(key: "registration_open", value: $v) { key } }`,
    { v: String(open) },
  );
  expect(result.errors, JSON.stringify(result.errors)).toBeUndefined();
}

/** 画面でメールとパスワードを入れてサインインを押す */
async function submitSignIn(page: Page, email: string) {
  await dismissDevOverlay(page);
  await page.locator('input[placeholder*="メールアドレス"], input[placeholder*="email"]').fill(email);
  await page.getByTestId('continue-login-button').click();
  await page.locator('input[type="password"]').waitFor({ state: 'visible' });
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByTestId('sign-in-button').click();
}

test.describe('サインインと登録 (M3)', () => {
  test.beforeAll(async () => {
    await ensureTestUser(BASE);
  });

  test('【重要】未登録のアドレスでは作らずに確かめる。戻れば作られず、作るを押すと作られる (#293)', async ({ page }) => {
    const email = uniqueEmail('confirm');
    await page.goto(`${BASE}/sign-in`);
    await submitSignIn(page, email);

    // 確かめる画面: 作られていない
    await expect(page.getByText('このメールアドレスは登録されていません')).toBeVisible({ timeout: 15_000 });
    expect((await signInApi({ email, password: PASSWORD })).name).toBe('USER_NOT_FOUND');

    // 戻る: 作られない
    await page.getByTestId('back-to-sign-in').click();
    await expect(page.getByTestId('continue-login-button')).toBeVisible();
    expect((await signInApi({ email, password: PASSWORD })).name).toBe('USER_NOT_FOUND');

    // もう一度 → 作る
    await submitSignIn(page, email);
    await expect(page.getByTestId('sign-in-button')).toHaveText(/アカウントを作成/, { timeout: 15_000 });
    await page.getByTestId('sign-in-button').click();
    await page.waitForURL(/\/workspace\//, { timeout: 30_000 });

    expect((await signInApi({ email, password: PASSWORD })).status).toBe(201);
  });

  test('AI 用 CLI と同じく create を送らなければ、作れる環境でもアカウントは作られない (4.4)', async () => {
    const email = uniqueEmail('cli');

    const first = await signInApi({ email, password: PASSWORD });
    const second = await signInApi({ email, password: PASSWORD });

    expect(first).toEqual({ status: 401, name: 'USER_NOT_FOUND' });
    expect(second.name).toBe('USER_NOT_FOUND');
  });

  test.describe('新規登録を閉じた環境', () => {
    let admin: string;
    let wsId: string | undefined;

    test.beforeAll(async () => {
      admin = await adminCookieFor(API);
    });

    test.afterEach(async () => {
      // ⚠️ 必ず開け直す（開発環境の設定）
      await setRegistrationOpen(admin, true);
      if (wsId) {
        await deleteWorkspaceAsAdmin(API, wsId);
        wsId = undefined;
      }
    });

    test('【重要】未登録のアドレスは、作ると言っても誤パスワードと同じ 401（存在を漏らさない）', async () => {
      await setRegistrationOpen(admin, false);

      const res = await signInApi({ email: uniqueEmail('closed'), password: PASSWORD, create: true });

      expect(res.status).toBe(401);
      expect(res.name).toBe('UNAUTHORIZED');
    });

    test('パスワードが無効と出たら、ログイン画面に戻ってアドレスを直せる', async ({ page }) => {
      await setRegistrationOpen(admin, false);
      await page.goto(`${BASE}/sign-in`);
      await submitSignIn(page, uniqueEmail('typo'));

      // 作れない環境なので、誤パスワードと同じ表示になる
      await expect(page.getByTestId('sign-in-button')).toHaveText('サインイン', { timeout: 15_000 });
      await expect(page.getByText('このパスワードは無効です')).toBeVisible({ timeout: 15_000 });

      // メールアドレスを直すために戻れる
      await page.getByTestId('back-to-sign-in').click();
      await expect(page.getByTestId('continue-login-button')).toBeVisible();
    });

    test('【重要】本人宛てのメール招待の URL からなら作れて、共有のメンバーになる (#195)', async ({ browser }) => {
      wsId = await importSharedWorkspace(API, `e2e-m3-invite-${Date.now()}`);
      const email = uniqueEmail('invited');
      const invited = await gql(
        admin,
        `mutation ($w: String!, $e: [String!]!) { inviteMembers(workspaceId: $w, emails: $e) { inviteId outcome } }`,
        { w: wsId, e: [email] },
      );
      const { inviteId, outcome } = invited.data.inviteMembers[0];
      expect(outcome).toBe('Invited');
      await setRegistrationOpen(admin, false);

      // 招待の URL を使わないサインインでは作れない
      expect((await signInApi({ email, password: PASSWORD, create: true })).name).toBe('UNAUTHORIZED');

      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.goto(`${BASE}/invite/${inviteId}`);
        await page.waitForURL(/sign-in/, { timeout: 30_000 });
        await submitSignIn(page, email);
        await expect(page.getByTestId('sign-in-button')).toHaveText(/アカウントを作成/, { timeout: 15_000 });
        await page.getByTestId('sign-in-button').click();

        // 招待のページに戻り、受ける
        await page.waitForURL(new RegExp(`/invite/${inviteId}`), { timeout: 30_000 });
        await page.getByRole('button', { name: /承認|参加/ }).click();
        await page.waitForURL(new RegExp(`/workspace/${wsId}`), { timeout: 30_000 });
      } finally {
        await context.close();
      }

      const members = await gql(
        admin,
        `query ($id: String!) { workspace(id: $id) { members(skip: 0, take: 100) { email } } }`,
        { id: wsId },
      );
      const emails = members.data.workspace.members.map((m: { email: string }) => m.email);
      expect(emails).toContain(email);
    });

    test('【重要】招待リンク（誰でも使える）では作れない (#195)', async () => {
      wsId = await importSharedWorkspace(API, `e2e-m3-link-${Date.now()}`);
      const link = await gql(
        admin,
        `mutation ($w: String!) { createInviteLink(workspaceId: $w, expireTime: OneWeek) { link } }`,
        { w: wsId },
      );
      const inviteId = String(link.data?.createInviteLink?.link ?? '').split('/').pop();
      expect(inviteId, JSON.stringify(link)).toBeTruthy();
      await setRegistrationOpen(admin, false);

      const res = await signInApi({
        email: uniqueEmail('link'),
        password: PASSWORD,
        create: true,
        inviteId,
      });

      expect(res.name).toBe('UNAUTHORIZED');
    });
  });

  test('アカウントの無い人への招待は、結果の通知で URL をコピーできる (4.3)', async ({ page, context }) => {
    const wsId = await importSharedWorkspace(API, `e2e-m3-copy-${Date.now()}`);
    const email = uniqueEmail('copy');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    try {
      // TEST_USER（システム管理者）として開く
      const res = await page.request.post('/api/auth/sign-in', {
        data: { email: TEST_USER.email, password: TEST_USER.password },
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.ok()).toBe(true);
      await page.goto(`/workspace/${wsId}/all`);
      await page.waitForURL(new RegExp(`/workspace/${wsId}`), { timeout: 30_000 });
      await dismissDevOverlay(page);
      await waitForWorkspaceInitialized(page);

      await page.locator('[data-testid="slider-bar-workspace-setting-button"]').click();
      await expect(page.locator('[data-testid="setting-modal"]')).toBeVisible({ timeout: 10_000 });
      await page.locator('[data-testid="workspace-setting:members"]').click();
      await page.getByRole('button', { name: 'メンバーを招待' }).click();
      await page.getByPlaceholder('メールアドレスを入力（カンマで区切る）').fill(email);
      await page.getByRole('button', { name: '招待を送る' }).click();

      const row = page.getByTestId('pending-invite').filter({ hasText: email });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByTestId('copy-invite-url').click();

      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toMatch(/\/invite\/[0-9a-f-]{36}$/);
    } finally {
      await deleteWorkspaceAsAdmin(API, wsId);
    }
  });
});
