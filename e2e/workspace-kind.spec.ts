import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import {
  TEST_USER,
  addToShared,
  deleteWorkspaceAsAdmin,
  importSharedWorkspace,
  dismissDevOverlay,
  ensureSidebarOpen,
  waitForWorkspaceInitialized,
} from './helpers';

/**
 * #297: **ワークスペースの種類（プライベートと共有）の芯。**
 *
 * - プライベート: 1 人 1 つ・本人だけ・招待できない・システム管理者も素通りしない
 * - 共有: システム管理者だけが作る・持ち主は root・システム管理者は素通りする
 *
 * 詳細は docs/workspace-model.md 12 章。
 *
 * ⚠️ **root（`.env` の ROOT_EMAIL）を消す・管理者を外す検査はここに書かない。**
 * 開発環境の root は利用者の実際のアカウントで、実装を誤ると本当に消える。
 * バックエンドの単体テストで確かめる。
 */

const API = process.env.API_URL || 'http://localhost:3010';

/** システム管理者（root ではない） */
const ADMIN = TEST_USER;
/** 共有ワークスペースの管理者にする一般ユーザー */
const MANAGER = {
  email: 'e2e-wskind-manager@ofuro-wiki.local',
  password: 'E2eWskindManager123!',
};
/** 一般ユーザー */
const MEMBER = {
  email: 'e2e-wskind-member@ofuro-wiki.local',
  password: 'E2eWskindMember123!',
};

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

const CREATE = `mutation ($name: String, $kind: WorkspaceKind) {
  createWorkspace(name: $name, kind: $kind) { id kind }
}`;

async function createShared(adminCookie: string, name: string): Promise<string> {
  const r = await gql(adminCookie, CREATE, { name, kind: 'Shared' });
  const id = r.data?.createWorkspace?.id;
  if (!id) {
    throw new Error(`共有を作れない: ${JSON.stringify(r)}`);
  }
  return id;
}

async function userId(cookie: string): Promise<string> {
  const r = await gql(cookie, `{ currentUser { id } }`);
  return r.data.currentUser.id;
}

/** 自分が持ち主のプライベートの数 */
async function privateCount(cookie: string): Promise<number> {
  const me = await userId(cookie);
  const r = await gql(cookie, `{ workspaces { id kind owner { id } } }`);
  return (r.data?.workspaces ?? []).filter(
    (w: { kind: string; owner: { id: string } }) => w.kind === 'Private' && w.owner.id === me,
  ).length;
}

test.describe('ワークスペースの種類（#297）', () => {
  test('一般ユーザーは共有を作れない。プライベートは 1 つまで', async () => {
    const member = await authCookie(MEMBER.email, MEMBER.password);

    const shared = await gql(member, CREATE, { name: 'e2e-wskind-ng', kind: 'Shared' });
    expect(shared.errors?.length ?? 0).toBeGreaterThan(0);

    // 1 回目は持っていなければ作れる。2 回目は必ず断られる
    await gql(member, CREATE, { kind: 'Private' });
    const second = await gql(member, CREATE, { kind: 'Private' });
    expect(second.errors?.length ?? 0).toBeGreaterThan(0);
    expect(await privateCount(member)).toBe(1);
  });

  // 着地でプライベートを作るかの判断に使う（docs/workspace-model.md 12.3.1）
  test('自分のプライベートの ID が分かる（無ければ null）', async () => {
    const member = await authCookie(MEMBER.email, MEMBER.password);
    await gql(member, CREATE, { kind: 'Private' });
    const me = await userId(member);
    const list = await gql(member, `{ workspaces { id kind owner { id } } }`);
    const mine = list.data.workspaces.find(
      (w: { kind: string; owner: { id: string } }) => w.kind === 'Private' && w.owner.id === me,
    );
    const r = await gql(member, `{ myPrivateWorkspaceId }`);
    expect(r.errors).toBeUndefined();
    expect(r.data.myPrivateWorkspaceId).toBe(mine.id);

    // まだプライベートを持たない人（新しく作ったユーザー）は null
    const fresh = await authCookie(`e2e-wskind-fresh-${Date.now()}@ofuro-wiki.local`, 'E2eWskindFresh123!');
    const none = await gql(fresh, `{ myPrivateWorkspaceId }`);
    expect(none.errors).toBeUndefined();
    expect(none.data.myPrivateWorkspaceId).toBeNull();
  });

  test('プライベートには招待できない', async () => {
    const member = await authCookie(MEMBER.email, MEMBER.password);
    await authCookie(MANAGER.email, MANAGER.password);
    await gql(member, CREATE, { kind: 'Private' });

    const me = await userId(member);
    const list = await gql(member, `{ workspaces { id kind owner { id } } }`);
    const mine = list.data.workspaces.find(
      (w: { kind: string; owner: { id: string } }) => w.kind === 'Private' && w.owner.id === me,
    );
    expect(mine).toBeTruthy();

    const invited = await gql(
      member,
      `mutation ($w: String!, $e: [String!]!) { inviteMembers(workspaceId: $w, emails: $e) { email } }`,
      { w: mine.id, e: [MANAGER.email] },
    );
    expect(invited.errors?.length ?? 0).toBeGreaterThan(0);

    const link = await gql(
      member,
      `mutation ($w: String!) { createInviteLink(workspaceId: $w, expireTime: OneWeek) { link } }`,
      { w: mine.id },
    );
    expect(link.errors?.length ?? 0).toBeGreaterThan(0);
  });

  test('⚠️ システム管理者は、メンバーでない共有を開ける。プライベートは開けない', async () => {
    const admin = await authCookie(ADMIN.email, ADMIN.password);
    const member = await authCookie(MEMBER.email, MEMBER.password);
    await gql(member, CREATE, { kind: 'Private' });
    const me = await userId(member);
    const list = await gql(member, `{ workspaces { id kind owner { id } } }`);
    const privateWs = list.data.workspaces.find(
      (w: { kind: string; owner: { id: string } }) => w.kind === 'Private' && w.owner.id === me,
    );

    const sharedId = await createShared(admin, 'e2e-wskind-admin-open');
    try {
      // 共有: 持ち主は root（作った管理者ではない）。管理者はメンバーでなくても開ける
      const shared = await gql(admin, `query ($id: String!) { workspace(id: $id) { id kind } }`, {
        id: sharedId,
      });
      expect(shared.errors).toBeUndefined();
      expect(shared.data.workspace.kind).toBe('Shared');

      // ⚠️ 画面は一覧（workspaces）に載っているものしか開けない。管理者の一覧に共有が載ること
      const list = await gql(admin, `{ workspaces { id } }`);
      const ids = list.data.workspaces.map((w: { id: string }) => w.id);
      expect(ids).toContain(sharedId);
      // プライベートは載らない
      expect(ids).not.toContain(privateWs.id);

      // ⚠️ プライベート: URL（ID）を知っていても開けない。GraphQL も REST も
      const priv = await gql(admin, `query ($id: String!) { workspace(id: $id) { id } }`, {
        id: privateWs.id,
      });
      expect(priv.errors?.length ?? 0).toBeGreaterThan(0);

      const rootDoc = await fetch(`${API}/api/workspaces/${privateWs.id}/docs/${privateWs.id}`, {
        headers: { Cookie: admin },
      });
      expect([403, 404]).toContain(rootDoc.status);
    } finally {
      await gql(admin, `mutation ($id: String!) { deleteWorkspace(id: $id) }`, { id: sharedId });
    }
  });

  test('ワークスペース管理者は招待できるが、管理者を任命できない', async () => {
    const admin = await authCookie(ADMIN.email, ADMIN.password);
    const manager = await authCookie(MANAGER.email, MANAGER.password);
    const member = await authCookie(MEMBER.email, MEMBER.password);
    const sharedId = await createShared(admin, 'e2e-wskind-manager');

    try {
      // 管理者が、一般ユーザーをワークスペース管理者にする
      await gql(
        admin,
        `mutation ($w: String!, $e: [String!]!) { inviteMembers(workspaceId: $w, emails: $e) { email } }`,
        { w: sharedId, e: [MANAGER.email] },
      );
      const granted = await gql(
        admin,
        `mutation ($w: String!, $u: String!, $p: Permission!) { grantMember(workspaceId: $w, userId: $u, permission: $p) }`,
        { w: sharedId, u: await userId(manager), p: 'Admin' },
      );
      expect(granted.errors).toBeUndefined();

      // ワークスペース管理者は招待できる
      const invited = await gql(
        manager,
        `mutation ($w: String!, $e: [String!]!) { inviteMembers(workspaceId: $w, emails: $e) { email outcome } }`,
        { w: sharedId, e: [MEMBER.email] },
      );
      expect(invited.errors).toBeUndefined();

      // ⚠️ 管理者の任命はできない
      const promote = await gql(
        manager,
        `mutation ($w: String!, $u: String!, $p: Permission!) { grantMember(workspaceId: $w, userId: $u, permission: $p) }`,
        { w: sharedId, u: await userId(member), p: 'Admin' },
      );
      expect(promote.errors?.length ?? 0).toBeGreaterThan(0);

      // ⚠️ ワークスペース管理者どうしで、下げる・外すはできない（2026-10-28 決定）
      // MEMBER をシステム管理者がワークスペース管理者にし、MANAGER から下げ・外しを試す
      const appointed = await gql(
        admin,
        `mutation ($w: String!, $u: String!) { grantMember(workspaceId: $w, userId: $u, permission: Admin) }`,
        { w: sharedId, u: await userId(member) },
      );
      expect(appointed.errors).toBeUndefined();
      const demote = await gql(
        manager,
        `mutation ($w: String!, $u: String!) { grantMember(workspaceId: $w, userId: $u, permission: Write) }`,
        { w: sharedId, u: await userId(member) },
      );
      expect(demote.errors?.length ?? 0).toBeGreaterThan(0);
      const remove = await gql(
        manager,
        `mutation ($w: String!, $u: String!) { revokeMember(workspaceId: $w, userId: $u) }`,
        { w: sharedId, u: await userId(member) },
      );
      expect(remove.errors?.length ?? 0).toBeGreaterThan(0);
      // システム管理者は下げられる。⚠️ 自分がメンバーとして入っていても（素通りが優先。PR #311 のレビュー）
      await gql(
        admin,
        `mutation ($w: String!, $e: [String!]!) { inviteMembers(workspaceId: $w, emails: $e) { email } }`,
        { w: sharedId, e: [ADMIN.email] },
      );
      const demotedByAdmin = await gql(
        admin,
        `mutation ($w: String!, $u: String!) { grantMember(workspaceId: $w, userId: $u, permission: Write) }`,
        { w: sharedId, u: await userId(member) },
      );
      expect(demotedByAdmin.errors).toBeUndefined();

      // ⚠️ 持ち主（root）を譲れない
      const transfer = await gql(
        admin,
        `mutation ($w: String!, $u: String!, $p: Permission!) { grantMember(workspaceId: $w, userId: $u, permission: $p) }`,
        { w: sharedId, u: await userId(member), p: 'Owner' },
      );
      expect(transfer.errors?.length ?? 0).toBeGreaterThan(0);

      // ワークスペース管理者は共有を消せない
      const del = await gql(manager, `mutation ($id: String!) { deleteWorkspace(id: $id) }`, {
        id: sharedId,
      });
      expect(del.errors?.length ?? 0).toBeGreaterThan(0);
    } finally {
      await gql(admin, `mutation ($id: String!) { deleteWorkspace(id: $id) }`, { id: sharedId });
    }
  });

  test('⚠️ 共有のメンバーのユーザーを消しても、共有は消えない（#296）', async () => {
    const admin = await authCookie(ADMIN.email, ADMIN.password);
    // 消すユーザーは実行ごとに作る
    const victim = {
      email: `e2e-wskind-victim-${Date.now()}@ofuro-wiki.local`,
      password: 'E2eWskindVictim123!',
    };
    const victimCookie = await authCookie(victim.email, victim.password);
    const victimId = await userId(victimCookie);
    const sharedId = await createShared(admin, 'e2e-wskind-survive');

    try {
      await gql(
        admin,
        `mutation ($w: String!, $e: [String!]!) { inviteMembers(workspaceId: $w, emails: $e) { email } }`,
        { w: sharedId, e: [victim.email] },
      );
      await gql(
        admin,
        `mutation ($w: String!, $u: String!, $p: Permission!) { grantMember(workspaceId: $w, userId: $u, permission: $p) }`,
        { w: sharedId, u: victimId, p: 'Admin' },
      );

      const deleted = await gql(admin, `mutation ($u: String!) { adminDeleteUser(userId: $u) }`, {
        u: victimId,
      });
      expect(deleted.errors).toBeUndefined();

      const still = await gql(admin, `query ($id: String!) { workspace(id: $id) { id kind } }`, {
        id: sharedId,
      });
      expect(still.errors).toBeUndefined();
      expect(still.data.workspace.id).toBe(sharedId);
    } finally {
      await gql(admin, `mutation ($id: String!) { deleteWorkspace(id: $id) }`, { id: sharedId });
    }
  });

  test('取り込み（import）はシステム管理者だけ', async () => {
    const member = await authCookie(MEMBER.email, MEMBER.password);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([0x50, 0x4b, 0x05, 0x06])]), 'x.zip');
    const res = await fetch(`${API}/api/workspaces/import`, {
      method: 'POST',
      headers: { Cookie: member },
      body: form,
    });
    expect(res.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // 画面（docs/workspace-model.md 12.3・12.3.1）
  // ---------------------------------------------------------------------------

  /** ブラウザでサインインし、着地（/）から最初のワークスペースが開くまで待つ */
  async function landAs(page: Page, user: { email: string; password: string }) {
    const res = await page.request.post('/api/auth/sign-in', {
      data: { email: user.email, password: user.password },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.ok()).toBe(true);
    await page.goto('/');
    await page.waitForURL(/\/workspace\//, { timeout: 60_000 });
    await dismissDevOverlay(page);
    await waitForWorkspaceInitialized(page);
  }

  /** クイック検索に「新規ワークスペース」が出るか */
  async function hasNewWorkspaceCommand(page: Page): Promise<boolean> {
    await ensureSidebarOpen(page);
    await page.locator('text=クイック検索').first().click();
    await expect(page.locator('input[cmdk-input]')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.type('新規ワークスペース', { delay: 50 });
    await page.waitForTimeout(1_500);
    // 完全一致で数える（「新しい「新規ワークスペース」ページ」などの作成候補も含まれるため）
    const count = await page.locator('[cmdk-item]', { hasText: /^新規ワークスペース$/ }).count();
    await page.keyboard.press('Escape');
    return count > 0;
  }

  test('⚠️ 共有のメンバーだけでプライベートが無い人も、サインインでプライベートが作られる', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const admin = await authCookie(ADMIN.email, ADMIN.password);
    const fresh = {
      email: `e2e-wskind-landing-${Date.now()}@ofuro-wiki.local`,
      password: 'E2eWskindLanding123!',
    };
    const freshCookie = await authCookie(fresh.email, fresh.password);
    const sharedId = await createShared(admin, 'e2e-wskind-landing');

    try {
      // 共有にだけ入っている（以前は、これで「ワークスペースがある」とみなされ、作られなかった）
      await gql(
        admin,
        `mutation ($w: String!, $e: [String!]!) { inviteMembers(workspaceId: $w, emails: $e) { email } }`,
        { w: sharedId, e: [fresh.email] },
      );
      const before = await gql(freshCookie, `{ myPrivateWorkspaceId }`);
      expect(before.data.myPrivateWorkspaceId).toBeNull();

      await landAs(page, fresh);

      await expect
        .poll(async () => (await gql(freshCookie, `{ myPrivateWorkspaceId }`)).data.myPrivateWorkspaceId, {
          timeout: 60_000,
        })
        .not.toBeNull();

      // ⚠️ 一般ユーザーには、クイック検索に「新規ワークスペース」を出さない（2 つ目を作る抜け道だった）
      expect(await hasNewWorkspaceCommand(page)).toBe(false);
    } finally {
      await gql(admin, `mutation ($id: String!) { deleteWorkspace(id: $id) }`, { id: sharedId });
    }
  });

  test('システム管理者には、クイック検索に「新規ワークスペース」が出る', async ({ page }) => {
    test.setTimeout(120_000);
    await landAs(page, ADMIN);
    expect(await hasNewWorkspaceCommand(page)).toBe(true);
  });

  test('⚠️ 作成のダイアログに「ワークスペースのタイプ」を出さない（ローカルに作れてしまう）', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await landAs(page, ADMIN);
    await ensureSidebarOpen(page);
    await page.locator('text=クイック検索').first().click();
    await expect(page.locator('input[cmdk-input]')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.type('新規ワークスペース', { delay: 50 });
    await page.locator('[cmdk-item]', { hasText: /^新規ワークスペース$/ }).click();

    await expect(page.getByTestId('create-workspace-input')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('ワークスペースのタイプ')).toHaveCount(0);
    await expect(page.getByText('ローカルストレージ')).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------
  // 管理画面「ワークスペース」（docs/workspace-model.md 12.8.1）
  // ---------------------------------------------------------------------------

  async function openAdminWorkspaces(page: Page) {
    await ensureSidebarOpen(page);
    const avatar = page.locator('[data-testid="sidebar-user-avatar"]');
    await avatar.waitFor({ state: 'attached', timeout: 15_000 });
    await avatar.click({ force: true });
    await page.locator('[data-testid="workspace-modal-account-admin-option"]').click();
    await page.locator('[data-testid="admin-workspaces-trigger"]').click();
  }

  const workspaceRow = (page: Page, name: string) =>
    page.locator('[data-testid="admin-workspace-row"]', { hasText: name });

  test('管理画面で共有を作り、開き、消せる', async ({ page }) => {
    test.setTimeout(180_000);
    const admin = await authCookie(ADMIN.email, ADMIN.password);
    const name = `e2e-wskind-panel-${Date.now()}`;
    await landAs(page, ADMIN);

    const listIds = async (): Promise<string[]> =>
      (await gql(admin, `{ adminWorkspaceList { id } }`)).data.adminWorkspaceList.map(
        (w: { id: string }) => w.id,
      );
    const before = await listIds();

    // 作る: 作成ダイアログ（Ctrl+K と同じ）を通すと、一覧に載る。
    // 名前はワークスペースの中（Yjs）から出す（サーバーの workspaces.name は既定値のまま）
    await openAdminWorkspaces(page);
    await page.locator('[data-testid="admin-create-workspace"]').click();
    await page.locator('[data-testid="create-workspace-input"]').fill(name);
    await page.locator('[data-testid="create-workspace-create-button"]').click();
    await expect(workspaceRow(page, name)).toBeVisible({ timeout: 30_000 });

    const added = (await listIds()).filter((id) => !before.includes(id));
    expect(added).toHaveLength(1);
    const created = { id: added[0] };
    const kind = await gql(admin, `{ workspaces { id kind } }`);
    expect(kind.data.workspaces.find((w: { id: string }) => w.id === created.id)?.kind).toBe('Shared');

    // 開く: 設定を閉じ、そのワークスペースへ移る
    await workspaceRow(page, name).getByRole('button', { name: '開く' }).click();
    await page.waitForURL(new RegExp(`/workspace/${created.id}/`), { timeout: 30_000 });
    await expect(page.locator('[data-testid="setting-modal"]')).toBeHidden();

    // 消す: 開いているものを消すと、着地へ戻る
    await waitForWorkspaceInitialized(page);
    await openAdminWorkspaces(page);
    await workspaceRow(page, name).getByRole('button', { name: '削除' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '削除' }).click();
    await page.waitForURL((url) => !url.pathname.includes(created.id), { timeout: 30_000 });

    await expect.poll(listIds).not.toContain(created.id);
  });

  test('⚠️ 管理画面の一覧は、システム管理者でなければ取れない', async () => {
    const member = await authCookie(MEMBER.email, MEMBER.password);
    const body = await gql(member, `{ adminWorkspaceList { id } }`);
    expect(body.errors?.[0]?.message).toMatch(/Admin access required/);
    expect(body.data).toBeNull();
  });

  // 設定画面の並びと「今のワークスペース」（docs/workspace-model.md 12.8.2）
  test('設定は「管理」が「ワークスペース」の上。ワークスペースの各項目に今のワークスペースを出す', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await landAs(page, ADMIN);
    await ensureSidebarOpen(page);
    const current = (await page.locator('[data-testid="workspace-name"]').first().innerText()).trim();

    await openAdminWorkspaces(page);
    const sidebar = page.locator('[data-testid="settings-sidebar"]');
    const text = await sidebar.innerText();
    expect(text.indexOf('管理')).toBeGreaterThan(-1);
    expect(text.indexOf('管理')).toBeLessThan(text.indexOf('優先順位'));

    for (const tab of ['preference', 'properties', 'members', 'storage']) {
      await page.locator(`[data-testid="workspace-setting:${tab}"]`).click();
      const note = page.locator('[data-testid="current-workspace-note"]');
      await expect(note, tab).toContainText(`今のワークスペース：${current}`);
      await expect(note, tab).toContainText('ワークスペースを切り替えてから');
    }
  });

  // ---------------------------------------------------------------------------
  // メンバー・書き出し・ユーザー管理（3c・docs/workspace-model.md 12.8.3）
  // 準備は API で行い、画面の出し分けだけを見る
  // ---------------------------------------------------------------------------

  /** ja.json の文言（docs/workspace-member-roles.md 3 章） */
  const MENU = {
    toAdmin: 'ワークスペース管理者に変更',
    toReader: '閲覧者（読み取りのみ）に変更',
    assignOwner: '所有者として割り当てる',
  };

  async function openWorkspaceAs(page: Page, user: { email: string; password: string }, wsId: string) {
    const res = await page.request.post('/api/auth/sign-in', {
      data: { email: user.email, password: user.password },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.ok()).toBe(true);
    await page.goto(`/workspace/${wsId}/all`);
    await page.waitForURL(new RegExp(`/workspace/${wsId}`), { timeout: 30_000 });
    await dismissDevOverlay(page);
    await waitForWorkspaceInitialized(page);
  }

  async function openWorkspaceSetting(page: Page, tab: 'members' | 'storage') {
    await page.locator('[data-testid="slider-bar-workspace-setting-button"]').click();
    await expect(page.locator('[data-testid="setting-modal"]')).toBeVisible({ timeout: 10_000 });
    await page.locator(`[data-testid="workspace-setting:${tab}"]`).click();
  }

  const memberRow = (page: Page, email: string) =>
    page.locator('[data-testid="member-item"]', { hasText: email });

  async function openRowMenu(page: Page, email: string) {
    const row = memberRow(page, email);
    await row.waitFor({ state: 'visible', timeout: 15_000 });
    await row.locator('button').last().click();
  }

  /** 指定のメンバーの役割（サーバーの値） */
  async function permissionOf(cookie: string, wsId: string, email: string) {
    const r = await gql(
      cookie,
      `query ($id: String!) { workspace(id: $id) { members(skip: 0, take: 50) { email permission } } }`,
      { id: wsId },
    );
    return r.data?.workspace?.members?.find((m: { email: string }) => m.email === email)?.permission;
  }

  test('システム管理者: 持ち主は「root」。ワークスペース管理者に任命でき、所有者の割り当ては出ない', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const manager = await authCookie(MANAGER.email, MANAGER.password);
    const member = await authCookie(MEMBER.email, MEMBER.password);
    const wsId = await importSharedWorkspace(API, `e2e-wskind-3c-admin-${Date.now()}`);

    try {
      await addToShared(API, wsId, manager, 'Admin');
      await addToShared(API, wsId, member, 'Write');

      await openWorkspaceAs(page, ADMIN, wsId);
      await openWorkspaceSetting(page, 'members');

      // 役割の名前
      await expect(memberRow(page, MANAGER.email).getByTestId('member-role')).toHaveText(
        'ワークスペース管理者',
        { timeout: 15_000 },
      );
      await expect(page.getByTestId('member-role').filter({ hasText: /^root$/ })).toHaveCount(1);

      // ︙: 任命が出る。所有者の割り当ては出ない
      await openRowMenu(page, MEMBER.email);
      await expect(page.getByRole('menuitem', { name: MENU.assignOwner })).toHaveCount(0);
      await page.getByRole('menuitem', { name: MENU.toAdmin }).click();
      await expect.poll(() => permissionOf(member, wsId, MEMBER.email), { timeout: 10_000 }).toBe('Admin');
    } finally {
      await deleteWorkspaceAsAdmin(API, wsId);
    }
  });

  test('ワークスペース管理者: メンバーを閲覧者に変えられる。任命は出ない', async ({ page }) => {
    test.setTimeout(180_000);
    const manager = await authCookie(MANAGER.email, MANAGER.password);
    const member = await authCookie(MEMBER.email, MEMBER.password);
    const wsId = await importSharedWorkspace(API, `e2e-wskind-3c-manager-${Date.now()}`);

    try {
      await addToShared(API, wsId, manager, 'Admin');
      await addToShared(API, wsId, member, 'Write');

      await openWorkspaceAs(page, MANAGER, wsId);
      await openWorkspaceSetting(page, 'members');

      await openRowMenu(page, MEMBER.email);
      await expect(page.getByRole('menuitem', { name: MENU.toAdmin })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: MENU.assignOwner })).toHaveCount(0);
      await page.getByRole('menuitem', { name: MENU.toReader }).click();
      await expect.poll(() => permissionOf(member, wsId, MEMBER.email), { timeout: 10_000 }).toBe('Read');
    } finally {
      await deleteWorkspaceAsAdmin(API, wsId);
    }
  });

  test('プライベート: 招待を出さず、役割は「持ち主」。書き出しは出て、取り込みは出ない', async ({ page }) => {
    test.setTimeout(180_000);
    // 着地でプライベートを作らせる（API で作ったものは中身が無く、画面で開けない）
    const fresh = {
      email: `e2e-wskind-private-${Date.now()}@ofuro-wiki.local`,
      password: 'E2eWskindPrivate123!',
    };
    const freshCookie = await authCookie(fresh.email, fresh.password);
    await landAs(page, fresh);
    await expect
      .poll(async () => (await gql(freshCookie, `{ myPrivateWorkspaceId }`)).data.myPrivateWorkspaceId, {
        timeout: 60_000,
      })
      .not.toBeNull();

    await openWorkspaceSetting(page, 'members');
    await expect(memberRow(page, fresh.email).getByTestId('member-role')).toHaveText('持ち主', {
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'メンバーを招待' })).toHaveCount(0);

    await page.locator('[data-testid="workspace-setting:storage"]').click();
    await expect(page.getByTestId('export-workspace-backup')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('import-workspace-backup')).toHaveCount(0);
  });

  test('共有の書き出しは、ワークスペース管理者に出し、メンバーには出さない', async ({ page }) => {
    test.setTimeout(180_000);
    const manager = await authCookie(MANAGER.email, MANAGER.password);
    const member = await authCookie(MEMBER.email, MEMBER.password);
    const wsId = await importSharedWorkspace(API, `e2e-wskind-3c-export-${Date.now()}`);

    try {
      await addToShared(API, wsId, manager, 'Admin');
      await addToShared(API, wsId, member, 'Write');

      await openWorkspaceAs(page, MANAGER, wsId);
      await openWorkspaceSetting(page, 'storage');
      await expect(page.getByTestId('export-workspace-backup')).toBeVisible({ timeout: 15_000 });

      await openWorkspaceAs(page, MEMBER, wsId);
      await openWorkspaceSetting(page, 'storage');
      // 見出しが出てから数える（読み込み前の 0 件で通らないように）
      await expect(page.getByTestId('current-workspace-note')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('export-workspace-backup')).toHaveCount(0);
    } finally {
      await deleteWorkspaceAsAdmin(API, wsId);
    }
  });

  test('管理画面「ワークスペース」から取り込むと、共有として一覧に載る', async ({ page }) => {
    test.setTimeout(180_000);
    const admin = await authCookie(ADMIN.email, ADMIN.password);
    const listIds = async (): Promise<string[]> =>
      (await gql(admin, `{ adminWorkspaceList { id } }`)).data.adminWorkspaceList.map(
        (w: { id: string }) => w.id,
      );
    const before = await listIds();

    await landAs(page, ADMIN);
    await openAdminWorkspaces(page);
    await page
      .getByTestId('admin-import-workspace-input')
      .setInputFiles(path.join(__dirname, 'fixtures', 'shared-workspace.ofuro-backup.zip'));

    await expect.poll(async () => (await listIds()).length, { timeout: 30_000 }).toBe(before.length + 1);
    const added = (await listIds()).filter((id) => !before.includes(id));
    try {
      await expect(page.locator('[data-testid="admin-workspace-row"]')).toHaveCount(before.length + 1, {
        timeout: 15_000,
      });
    } finally {
      for (const id of added) {
        await deleteWorkspaceAsAdmin(API, id);
      }
    }
  });

  async function openAdminUsers(page: Page, search: string) {
    await ensureSidebarOpen(page);
    const avatar = page.locator('[data-testid="sidebar-user-avatar"]');
    await avatar.waitFor({ state: 'attached', timeout: 15_000 });
    await avatar.click({ force: true });
    await page.locator('[data-testid="workspace-modal-account-admin-option"]').click();
    await page.locator('[data-testid="admin-users-trigger"]').click();
    await page.getByTestId('admin-user-search').fill(search);
  }

  const userRow = (page: Page, email: string) =>
    page.getByTestId('admin-user-row').filter({ hasText: email });

  // ⚠️ root の行は見るだけ。押さない（開発環境の root は利用者の実際のアカウント）
  test('ユーザー管理: root に「root」、ほかのシステム管理者に「システム管理者」。root の行に削除・切り替えを出さない', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const admin = await authCookie(ADMIN.email, ADMIN.password);
    // 新しい順に並ぶため、古い root は後ろのページに居る。全ページから探す
    let root: { email: string } | undefined;
    for (let skip = 0; !root; skip += 100) {
      const res = await gql(
        admin,
        `query ($skip: Int) { adminUserList(skip: $skip, take: 100) { items { email isRoot } totalCount } }`,
        { skip },
      );
      expect(res.errors).toBeUndefined();
      root = res.data.adminUserList.items.find((u: { isRoot: boolean }) => u.isRoot);
      if (skip + 100 >= res.data.adminUserList.totalCount) {
        break;
      }
    }
    test.skip(!root, 'ROOT_EMAIL のユーザーが居ない環境');

    await landAs(page, ADMIN);
    await openAdminUsers(page, root.email);
    const rootRow = userRow(page, root.email);
    await expect(rootRow.getByTestId('admin-user-badge')).toHaveText('root', { timeout: 15_000 });
    await expect(rootRow.getByRole('switch')).toHaveCount(0);
    await rootRow.getByTestId('admin-user-actions').click();
    await expect(page.getByTestId('admin-delete-user')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByTestId('admin-user-search').fill(ADMIN.email);
    await expect(userRow(page, ADMIN.email).getByTestId('admin-user-badge')).toHaveText('システム管理者', {
      timeout: 15_000,
    });
  });

  test('ユーザー削除の確認に、一緒に消えるプライベートの名前を出す', async ({ page }) => {
    test.setTimeout(180_000);
    const fresh = {
      email: `e2e-wskind-del-${Date.now()}@ofuro-wiki.local`,
      password: 'E2eWskindDel123!',
    };
    const freshCookie = await authCookie(fresh.email, fresh.password);
    const name = `e2e-private-${Date.now()}`;
    await gql(freshCookie, CREATE, { name, kind: 'Private' });

    await landAs(page, ADMIN);
    await openAdminUsers(page, fresh.email);
    await userRow(page, fresh.email).getByTestId('admin-user-actions').click({ timeout: 15_000 });
    await page.getByTestId('admin-delete-user').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`このユーザーのプライベート（${name}）が一緒に消えます`, {
      timeout: 15_000,
    });
    await dialog.getByRole('button', { name: '削除' }).click();
    await expect(userRow(page, fresh.email)).toHaveCount(0, { timeout: 15_000 });
  });
});
