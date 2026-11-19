/**
 * #330: SSO 設定の欄に、ブラウザの自動入力でサインイン用のメールアドレスとパスワードが入らないこと。
 *
 * 2026-11-10 社内本番で、クライアント ID にメールアドレス、シークレットにパスワードが自動で入り、
 * 欄から離れた時点で保存されていた（docs/sso-setup.md「ブラウザの自動入力を止める」）。
 * 自動入力そのものはブラウザの機能でテストから起こせないため、止める指定が付いていることを確かめる。
 * Keycloak が無くても流れる（sso.spec.ts と分けている）。
 */
import { test, expect } from '@playwright/test';
import {
  dismissDevOverlay,
  ensureSidebarOpen,
  ensureTestUser,
  signInViaAPI,
  waitForWorkspaceInitialized,
} from './helpers';

const BASE = process.env.BASE_URL || 'http://localhost:8080';

test('SSO 設定のクライアント ID とシークレットは、自動入力の対象にしない（#330）', async ({
  page,
}) => {
  await ensureTestUser(BASE);
  await signInViaAPI(page);
  await page.goto(`${BASE}/`);
  await page.waitForURL(/\/workspace\//, { timeout: 30_000 });
  await dismissDevOverlay(page);
  await waitForWorkspaceInitialized(page);

  // 管理画面 → サーバー設定
  await ensureSidebarOpen(page);
  await page.locator('[data-testid="sidebar-user-avatar"]').click({ force: true });
  await page.locator('[data-testid="workspace-modal-account-admin-option"]').click();
  await page.locator('[data-testid="admin-settings-trigger"]').click();

  const clientId = page.locator('input[name="oidc-client-id"]');
  const secret = page.locator('input[name="oidc-client-secret"]');
  await expect(clientId).toBeVisible({ timeout: 15_000 });

  // ブラウザ: ユーザー名・パスワードの欄とみなさない
  await expect(clientId).toHaveAttribute('autocomplete', 'off');
  await expect(secret).toHaveAttribute('autocomplete', 'new-password');
  await expect(secret).toHaveAttribute('type', 'password');

  // パスワードマネージャー（1Password・LastPass・Bitwarden）
  for (const field of [clientId, secret]) {
    await expect(field).toHaveAttribute('data-1p-ignore', 'true');
    await expect(field).toHaveAttribute('data-lpignore', 'true');
    await expect(field).toHaveAttribute('data-bwignore', 'true');
  }
});
