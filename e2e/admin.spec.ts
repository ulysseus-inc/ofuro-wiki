/**
 * ofuro-wiki 管理パネル E2E テスト
 *
 * 前提条件:
 *   - PostgreSQL が起動済み (docker compose up -d)
 *   - バックエンド (port 3010) が起動済み
 *   - フロントエンド (port 8080) が起動済み
 *   - 環境変数 ADMIN_EMAIL=e2e-test@ofuro-wiki.local でバックエンド起動
 *
 * 実行方法:
 *   cd e2e && npx playwright test admin.spec.ts
 */
import { test, expect } from '@playwright/test';
import {
  TEST_USER,
  ensureTestUser,
  signIn,
  enterOrCreateWorkspace,
  graphqlQuery,
  ensureSidebarOpen,
} from './helpers';

const BACKEND_URL = 'http://localhost:3010';

// ---------------------------------------------------------------------------
// セットアップ: テストユーザーを Admin に昇格
// ---------------------------------------------------------------------------
test.beforeAll(async () => {
  await ensureTestUser(BACKEND_URL);

  // テストユーザーを Admin に設定（直接 GraphQL）
  const signInRes = await fetch(`${BACKEND_URL}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: TEST_USER.email,
      password: TEST_USER.password,
    }),
  });
  const cookies = signInRes.headers.getSetCookie?.() ?? [];
  const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');

  // isAdmin = true に設定（SQL 直接は使えないので seedAdmin に任せるか、
  // Admin API で自分自身を昇格させる — ここではバックエンドの seedAdmin を前提とする）
  // ADMIN_EMAIL 環境変数でバックエンド起動時に設定済みの前提
});

// ---------------------------------------------------------------------------
// 1. Admin API テスト（GraphQL 経由）
// ---------------------------------------------------------------------------
test.describe('Admin API', () => {
  test.describe.configure({ mode: 'serial' });

  test('currentUser の features に Admin が含まれる', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const result = await graphqlQuery(
      page,
      '{ currentUser { id email features } }'
    );
    expect(result.data.currentUser.features).toContain('Admin');
  });

  test('adminUserList でユーザー一覧を取得できる', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const result = await graphqlQuery(
      page,
      '{ adminUserList { items { id email isAdmin } totalCount } }'
    );
    expect(result.data.adminUserList.totalCount).toBeGreaterThanOrEqual(1);
    expect(result.data.adminUserList.items[0].email).toBeTruthy();
  });

  test('adminCreateUser でユーザーを作成できる', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const email = `admin-test-${Date.now()}@ofuro-wiki.local`;
    const result = await graphqlQuery(
      page,
      `mutation {
        adminCreateUser(input: { email: "${email}", password: "TestPass123!" }) {
          id email isAdmin
        }
      }`
    );
    expect(result.data.adminCreateUser.email).toBe(email);
    expect(result.data.adminCreateUser.isAdmin).toBe(false);

    // クリーンアップ: 作成したユーザーを削除
    const userId = result.data.adminCreateUser.id;
    await graphqlQuery(
      page,
      `mutation { adminDeleteUser(userId: "${userId}") }`
    );
  });

  test('adminSetUserAdmin で Admin 権限を付与・剥奪できる', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    // テスト用ユーザーを作成
    const email = `admin-toggle-${Date.now()}@ofuro-wiki.local`;
    const createResult = await graphqlQuery(
      page,
      `mutation {
        adminCreateUser(input: { email: "${email}", password: "TestPass123!" }) {
          id isAdmin
        }
      }`
    );
    const userId = createResult.data.adminCreateUser.id;

    // Admin に昇格
    const setResult = await graphqlQuery(
      page,
      `mutation { adminSetUserAdmin(userId: "${userId}", isAdmin: true) { id isAdmin } }`
    );
    expect(setResult.data.adminSetUserAdmin.isAdmin).toBe(true);

    // Admin から降格
    const unsetResult = await graphqlQuery(
      page,
      `mutation { adminSetUserAdmin(userId: "${userId}", isAdmin: false) { id isAdmin } }`
    );
    expect(unsetResult.data.adminSetUserAdmin.isAdmin).toBe(false);

    // クリーンアップ
    await graphqlQuery(
      page,
      `mutation { adminDeleteUser(userId: "${userId}") }`
    );
  });

  test('adminServerSettings でサーバー設定を変更できる', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    // 設定を変更
    const result = await graphqlQuery(
      page,
      `mutation {
        adminUpdateServerSetting(key: "site_name", value: "E2E Test Wiki") {
          key value
        }
      }`
    );
    expect(result.data.adminUpdateServerSetting.key).toBe('site_name');
    expect(result.data.adminUpdateServerSetting.value).toBe('E2E Test Wiki');

    // 設定一覧を取得
    const listResult = await graphqlQuery(
      page,
      '{ adminServerSettings { key value } }'
    );
    const siteName = listResult.data.adminServerSettings.find(
      (s: any) => s.key === 'site_name'
    );
    expect(siteName?.value).toBe('E2E Test Wiki');
  });
});

// ---------------------------------------------------------------------------
// 2. Admin Panel UI テスト
// ---------------------------------------------------------------------------
test.describe('Admin Panel UI', () => {
  test.describe.configure({ mode: 'serial' });

  test('Admin ユーザーのアバターメニューに Admin Panel が表示される', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);
    await ensureSidebarOpen(page);

    // サイドバーが完全にロードされるまで待機
    await page.waitForTimeout(2_000);

    // ユーザーアバターをクリック
    const avatar = page.locator('[data-testid="sidebar-user-avatar"]');
    await avatar.waitFor({ state: 'attached', timeout: 15_000 });
    await avatar.click({ force: true });
    await page.waitForTimeout(1_000);

    // Admin Panel メニューが表示される
    await expect(
      page.locator('[data-testid="workspace-modal-account-admin-option"]')
    ).toBeVisible({ timeout: 5_000 });
  });

  test('Admin Panel をクリックすると Settings ダイアログが開く', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);
    await ensureSidebarOpen(page);

    // サイドバーが完全にロードされるまで待機
    await page.waitForTimeout(2_000);

    // ユーザーアバターをクリック → Admin Panel
    const avatar = page.locator('[data-testid="sidebar-user-avatar"]');
    await avatar.waitFor({ state: 'attached', timeout: 15_000 });
    await avatar.click({ force: true });
    await page.waitForTimeout(1_000);
    await page.locator('[data-testid="workspace-modal-account-admin-option"]').click();
    await page.waitForTimeout(1_000);

    // Settings ダイアログが表示される
    await expect(page.locator('[data-testid="setting-modal"]')).toBeVisible({ timeout: 5_000 });

    // Administration セクション（管理）と Admin メニューが表示される
    const hasAdmin = await page.evaluate(() => {
      return document.body.innerText.includes('管理') ||
             document.body.innerText.includes('Administration') ||
             document.body.innerText.includes('User Management');
    });
    expect(hasAdmin).toBe(true);
  });

  test('Admin 画面のラベルがデフォルト言語（日本語）で表示される', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);
    await ensureSidebarOpen(page);

    // Admin Panel を開く
    const avatar = page.locator('[data-testid="sidebar-user-avatar"]');
    await avatar.waitFor({ state: 'attached', timeout: 15_000 });
    await avatar.click({ force: true });
    await page
      .locator('[data-testid="workspace-modal-account-admin-option"]')
      .click();
    await expect(page.locator('[data-testid="setting-modal"]')).toBeVisible({
      timeout: 5_000,
    });

    // サイドバーの Admin ナビが i18n 化され、日本語ラベルが表示される（#35）
    const body = page.locator('body');
    await expect(body).toContainText('ユーザー管理');
    await expect(body).toContainText('サーバー設定');
    // i18n キーが解決されず生のキー文字列が出ていないこと（リグレッション検知）
    await expect(body).not.toContainText('com.affine.admin');

    // ユーザー管理パネルを開いて本文ラベルも日本語であることを確認
    await page.locator('[data-testid="admin-users-trigger"]').click();
    await expect(body).toContainText('ユーザーと管理者権限を管理します');
    await expect(body).toContainText('ユーザーを追加');
  });
});
