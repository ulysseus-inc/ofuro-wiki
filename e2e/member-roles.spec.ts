import { test, expect, type Page } from '@playwright/test';
import {
  TEST_USER,
  addToShared,
  deleteWorkspaceAsAdmin,
  dismissDevOverlay,
  importSharedWorkspace,
  waitForWorkspaceInitialized,
} from './helpers';

/**
 * #215: **オーナーを譲ったあと、元のオーナーを通常のメンバーへ戻せること。**
 *
 * オーナーを譲ると元のオーナーは管理者になる。以前は管理者の行に
 * 「役割を協力者に変更する」が出ていたが、`Collaborator` はバックエンドの
 * `Permission` に無いため**押すと必ず失敗し、戻す手段が無かった**。
 *
 * 準備（参加・譲渡）は API で行い、検査したい操作だけを画面で行う。
 * 詳細は docs/workspace-member-roles.md
 */

const API = process.env.API_URL || 'http://localhost:3010';

const OWNER = {
  email: 'e2e-role-owner@ofuro-wiki.local',
  password: 'E2eRoleOwner123!',
};
const MEMBER = {
  email: 'e2e-role-member@ofuro-wiki.local',
  password: 'E2eRoleMember123!',
};

/** 「メンバー（編集可能）に変更」（ja.json の com.affine.payment.member.team.change.member） */
const CHANGE_TO_MEMBER = 'メンバー（編集可能）に変更';

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
  return res.json();
}

/** ブラウザで指定のユーザーとしてサインインし、ワークスペースを開く */
async function openWorkspaceAs(page: Page, user: typeof OWNER, workspaceId: string) {
  const res = await page.request.post('/api/auth/sign-in', {
    data: { email: user.email, password: user.password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok()).toBe(true);

  await page.goto(`/workspace/${workspaceId}/all`);
  await page.waitForURL(new RegExp(`/workspace/${workspaceId}`), { timeout: 30_000 });
  await dismissDevOverlay(page);
  await waitForWorkspaceInitialized(page);
}

/** 指定のメンバーの役割（サーバーの値） */
async function permissionOf(cookie: string, workspaceId: string, email: string) {
  const res = await gql(
    cookie,
    `query ($id: String!) { workspace(id: $id) { members(skip: 0, take: 50) { email permission } } }`,
    { id: workspaceId },
  );
  return res.data?.workspace?.members?.find((m: { email: string }) => m.email === email)
    ?.permission;
}

/** システム管理者（共有を素通りで管理できる） */
const ADMIN = TEST_USER;

test.describe('ワークスペースのメンバーの役割（#215）', () => {
  /**
   * #297: 共有の持ち主は root に固定で、譲れない。以前の「オーナーを譲ったあと、
   * 元のオーナー（管理者）をメンバーに戻す」は、「ワークスペース管理者をメンバーに戻す」になった。
   * #215 で直した「戻す手段が無い（協力者に変更する、が必ず失敗する）」はそのまま見る。
   */
  test('⚠️ ワークスペース管理者を、メンバーに戻せる', async ({ page }) => {
    const ownerCookie = await authCookie(OWNER.email, OWNER.password);
    const memberCookie = await authCookie(MEMBER.email, MEMBER.password);
    const wsId = await importSharedWorkspace(API, `e2e-roles-${Date.now()}`);

    try {
      // --- 準備: OWNER をワークスペース管理者、MEMBER をメンバーにする
      await addToShared(API, wsId, ownerCookie, 'Admin');
      await addToShared(API, wsId, memberCookie, 'Write');
      expect(await permissionOf(memberCookie, wsId, OWNER.email)).toBe('Admin');

      // --- 画面: システム管理者が、メンバー一覧を開く
      await openWorkspaceAs(page, ADMIN, wsId);
      await page.locator('[data-testid="slider-bar-workspace-setting-button"]').click();
      await expect(page.locator('[data-testid="setting-modal"]')).toBeVisible({ timeout: 10_000 });
      await page.locator('[data-testid="workspace-setting:members"]').click();

      // ワークスペース管理者の行の「︙」を開く
      const row = page.locator('[data-testid="member-item"]', { hasText: OWNER.email });
      await row.waitFor({ state: 'visible', timeout: 15_000 });
      await row.locator('button').last().click();

      // ⚠️ 協力者（Collaborator）は出さない。送ると必ず失敗する
      await expect(page.getByRole('menuitem', { name: '役割を協力者に変更する' })).toHaveCount(0);

      await page.getByRole('menuitem', { name: CHANGE_TO_MEMBER }).click();

      // --- 結果: サーバー上で、ワークスペース管理者がメンバー（Write）になっている
      await expect
        .poll(() => permissionOf(memberCookie, wsId, OWNER.email), { timeout: 10_000 })
        .toBe('Write');
      await expect(page.getByText('Operation failed')).toHaveCount(0);
    } finally {
      await deleteWorkspaceAsAdmin(API, wsId);
    }
  });
});

/**
 * #221: ⚠️ **設定 → メンバー の見出しに、実際の人数を出すこと。**
 *
 * 以前は AFFiNE の席数の表示を止めたときの仮の値（0 人・上限 Infinity）が固定で入っていて、
 * 人数に関係なく常に「メンバー (0/Infinity)」になっていた。
 */
test.describe('メンバーの見出しの人数（#221）', () => {
  test('⚠️ 見出しに実際の人数が出る（0/Infinity にならない）', async ({ page }) => {
    const ownerCookie = await authCookie(OWNER.email, OWNER.password);
    const memberCookie = await authCookie(MEMBER.email, MEMBER.password);
    const wsId = await importSharedWorkspace(API, `e2e-count-${Date.now()}`);

    try {
      // --- 準備: root（持ち主）＋ OWNER（ワークスペース管理者）＋ MEMBER → 3 人
      await addToShared(API, wsId, ownerCookie, 'Admin');
      await addToShared(API, wsId, memberCookie, 'Write');

      // --- 画面: ワークスペース管理者が、設定 → メンバー を開く
      await openWorkspaceAs(page, OWNER, wsId);
      await page.locator('[data-testid="slider-bar-workspace-setting-button"]').click();
      await expect(page.locator('[data-testid="setting-modal"]')).toBeVisible({ timeout: 10_000 });
      await page.locator('[data-testid="workspace-setting:members"]').click();

      // --- 結果: 見出しが「メンバー (3)」（一覧を読み込むと人数が入る）
      const modal = page.locator('[data-testid="setting-modal"]');
      await expect(modal.getByText('メンバー (3)', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(modal.getByText(/Infinity/)).toHaveCount(0);
    } finally {
      await deleteWorkspaceAsAdmin(API, wsId);
    }
  });
});
