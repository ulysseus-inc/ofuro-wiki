import { test, expect, type Page } from '@playwright/test';
import {
  dismissDevOverlay,
  getOwnedWorkspaceId,
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

/** ブラウザで指定のユーザーとしてサインインし、自分のワークスペース（無ければ作られる）を開く */
async function openOwnWorkspaceAs(page: Page, user: typeof OWNER) {
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

test.describe('ワークスペースのメンバーの役割（#215）', () => {
  test('⚠️ オーナーを譲ったあと、元のオーナーをメンバーに戻せる', async ({ page }) => {
    const ownerCookie = await authCookie(OWNER.email, OWNER.password);
    const memberCookie = await authCookie(MEMBER.email, MEMBER.password);

    // --- 準備: 元のオーナーがブラウザでサインインし、自分のワークスペースを作らせる
    // ⚠️ API の createWorkspace は行だけで中身を作らない。画面で開くと
    // 「ワークスペースを読み込めませんでした」になる（中身は画面が作るときに書き込む）
    await openOwnWorkspaceAs(page, OWNER);
    const wsId = await getOwnedWorkspaceId(page);
    expect(wsId).toBeTruthy();
    if (!wsId) {
      return;
    }

    try {
      const invited = await gql(
        ownerCookie,
        `mutation ($w: String!, $e: [String!]!) { inviteMembers(workspaceId: $w, emails: $e) { inviteId } }`,
        { w: wsId, e: [MEMBER.email] },
      );
      const inviteId = invited.data?.inviteMembers?.[0]?.inviteId;
      expect(inviteId).toBeTruthy();

      const accepted = await gql(
        memberCookie,
        `mutation ($w: String!, $i: String!) { acceptInviteById(workspaceId: $w, inviteId: $i) }`,
        { w: wsId, i: inviteId },
      );
      expect(accepted.errors).toBeUndefined();

      // --- 準備: オーナーを譲る → 元のオーナーは管理者になる
      const granted = await gql(
        ownerCookie,
        `mutation ($w: String!, $u: String!, $p: Permission!) { grantMember(workspaceId: $w, userId: $u, permission: $p) }`,
        {
          w: wsId,
          u: (await gql(memberCookie, `{ currentUser { id } }`)).data.currentUser.id,
          p: 'Owner',
        },
      );
      expect(granted.errors).toBeUndefined();
      expect(await permissionOf(memberCookie, wsId, OWNER.email)).toBe('Admin');

      // --- 画面: 新しいオーナーが、メンバー一覧を開く
      await page.context().clearCookies();
      await openWorkspaceAs(page, MEMBER, wsId);
      await page.locator('[data-testid="slider-bar-workspace-setting-button"]').click();
      await expect(page.locator('[data-testid="setting-modal"]')).toBeVisible({ timeout: 10_000 });
      await page.locator('[data-testid="workspace-setting:members"]').click();

      // 元のオーナー（管理者）の行の「︙」を開く
      const row = page.locator('[data-testid="member-item"]', { hasText: OWNER.email });
      await row.waitFor({ state: 'visible', timeout: 15_000 });
      await row.locator('button').last().click();

      // ⚠️ 協力者（Collaborator）は出さない。送ると必ず失敗する
      await expect(page.getByRole('menuitem', { name: '役割を協力者に変更する' })).toHaveCount(0);

      await page.getByRole('menuitem', { name: CHANGE_TO_MEMBER }).click();

      // --- 結果: サーバー上で、元のオーナーがメンバー（Write）になっている
      await expect
        .poll(() => permissionOf(memberCookie, wsId, OWNER.email), { timeout: 10_000 })
        .toBe('Write');
      await expect(page.getByText('Operation failed')).toHaveCount(0);
    } finally {
      // 後片付け: いまのオーナー（元メンバー）が消す
      await gql(memberCookie, `mutation ($id: String!) { deleteWorkspace(id: $id) }`, { id: wsId });
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

    // --- 準備: オーナーのワークスペース（画面で作らせる）に、もう1人を参加させる → 2人
    await openOwnWorkspaceAs(page, OWNER);
    const wsId = await getOwnedWorkspaceId(page);
    expect(wsId).toBeTruthy();
    if (!wsId) {
      return;
    }

    try {
      const invited = await gql(
        ownerCookie,
        `mutation ($w: String!, $e: [String!]!) { inviteMembers(workspaceId: $w, emails: $e) { inviteId } }`,
        { w: wsId, e: [MEMBER.email] },
      );
      const accepted = await gql(
        memberCookie,
        `mutation ($w: String!, $i: String!) { acceptInviteById(workspaceId: $w, inviteId: $i) }`,
        { w: wsId, i: invited.data?.inviteMembers?.[0]?.inviteId },
      );
      expect(accepted.errors).toBeUndefined();

      // --- 画面: 設定 → メンバー を開く
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForWorkspaceInitialized(page);
      await page.locator('[data-testid="slider-bar-workspace-setting-button"]').click();
      await expect(page.locator('[data-testid="setting-modal"]')).toBeVisible({ timeout: 10_000 });
      await page.locator('[data-testid="workspace-setting:members"]').click();

      // --- 結果: 見出しが「メンバー (2)」（一覧を読み込むと人数が入る）
      const modal = page.locator('[data-testid="setting-modal"]');
      await expect(modal.getByText('メンバー (2)', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(modal.getByText(/Infinity/)).toHaveCount(0);
    } finally {
      // 後片付け: ワークスペースごと消す
      await gql(ownerCookie, `mutation ($id: String!) { deleteWorkspace(id: $id) }`, { id: wsId });
    }
  });
});
