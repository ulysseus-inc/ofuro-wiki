import { test, expect, type Page } from '@playwright/test';
import {
  addToShared,
  deleteWorkspaceAsAdmin,
  dismissDevOverlay,
  importSharedWorkspace,
  waitForWorkspaceInitialized,
} from './helpers';

/**
 * #298: **共有メニューで人を選んだときの権限は「編集可能」から始まること。**
 *
 * 以前は「管理可能」で、そのまま招待すると、選ばれた人がさらに別の人へ
 * ページを見せられた（絞ったはずのページが知らないうちに広がる）。
 *
 * 準備（ページ・メンバー）は API で行い、検査したい操作（人を選んで招待）だけを画面で行う。
 * 詳細は docs/doc-sharing.md 7 章
 */

const API = process.env.API_URL || 'http://localhost:3010';

const OWNER = {
  email: 'e2e-shrole-owner@ofuro-wiki.local',
  password: 'E2eShroleOwner123!',
};
const MEMBER = {
  email: 'e2e-shrole-member@ofuro-wiki.local',
  password: 'E2eShroleMember123!',
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

/**
 * #297: 招待できるのは共有だけ。共有は取り込んで作り（API で作ると中身が空で開けない）、
 * OWNER をワークスペース管理者、MEMBER をメンバーにして、OWNER として開く
 */
async function openSharedAsManager(
  page: Page,
  ownerCookie: string,
  memberCookie: string,
): Promise<string> {
  const wsId = await importSharedWorkspace(API, `e2e-shrole-${Date.now()}`);
  await addToShared(API, wsId, ownerCookie, 'Admin');
  await addToShared(API, wsId, memberCookie, 'Write');

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

/** ページに個別に権限を配られた人と、その権限 */
async function grantedRoles(cookie: string, wsId: string, docId: string) {
  const r = await gql(
    cookie,
    `query ($w: String!, $d: String!, $p: PaginationInput!) {
      workspace(id: $w) {
        doc(docId: $d) {
          grantedUsersList(pagination: $p) { edges { node { role user { email } } } }
        }
      }
    }`,
    { w: wsId, d: docId, p: { first: 50 } },
  );
  const edges = r.data?.workspace?.doc?.grantedUsersList?.edges ?? [];
  return new Map<string, string>(
    edges.map((e: { node: { role: string; user: { email: string } } }) => [
      e.node.user.email,
      e.node.role,
    ]),
  );
}

test.describe('共有メニューで人を選んだときの権限（#298）', () => {
  test('⚠️ 初期値は「編集可能」。そのまま招待すると Editor で配られる', async ({ page }) => {
    test.setTimeout(180_000);
    const ownerCookie = await authCookie(OWNER.email, OWNER.password);
    const memberCookie = await authCookie(MEMBER.email, MEMBER.password);
    // 招待先の候補に出るよう、MEMBER はワークスペースのメンバーにしておく
    const wsId = await openSharedAsManager(page, ownerCookie, memberCookie);

    try {

    // サーバー側に直接作る（台帳に載る前のページだと共有メニューがスケルトンのまま）
    const docId = `share-role-e2e-${Date.now()}`;
    const res = await page.request.post('/api/internal/docs/upsert', {
      data: { workspaceId: wsId, docId, title: '権限の初期値の検査', markdown: '本文' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(200);

    await page.goto(`/workspace/${wsId}/${docId}`);
    await dismissDevOverlay(page);
    await page
      .locator('[data-testid="cloud-share-menu-button"], [data-testid="local-share-menu-button"]')
      .first()
      .click();

    // 「他のメンバーを招待」→ 名前で探して選ぶ
    await page.getByPlaceholder('他のメンバーを招待').first().click({ timeout: 30_000 });
    await page.getByPlaceholder('他のメンバーを招待').last().fill('e2e-shrole-member');
    await page.getByText(MEMBER.email).first().click({ timeout: 15_000 });

    // ⚠️ 選んだときの権限の表示が「編集可能」
    await expect(page.getByRole('button', { name: '編集可能' })).toBeVisible();
    await expect(page.getByRole('button', { name: '管理可能' })).toHaveCount(0);

    await page.getByRole('button', { name: '招待', exact: true }).click();

    // サーバーにも Editor で記録される（表示だけ変えて中身が Manager、を見逃さない）
    await expect
      .poll(async () => (await grantedRoles(ownerCookie, wsId, docId)).get(MEMBER.email), {
        timeout: 15_000,
      })
      .toBe('Editor');
    } finally {
      await deleteWorkspaceAsAdmin(API, wsId);
    }
  });
});
