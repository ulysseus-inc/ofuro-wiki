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

  test('【重要】パスワード再設定 URL を発行できる（#115）', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const email = `reset-target-${Date.now()}@example.com`;
    const created = await graphqlQuery(
      page,
      `mutation {
        adminCreateUser(input: { email: "${email}", password: "TestPass123!" }) { id }
      }`
    );
    const userId = created.data.adminCreateUser.id;

    const result = await graphqlQuery(
      page,
      `mutation ($userId: String!, $callbackUrl: String!) {
        createChangePasswordUrl(userId: $userId, callbackUrl: $callbackUrl)
      }`,
      { userId, callbackUrl: 'http://localhost:8080/auth/changePassword' }
    );

    expect(result.errors).toBeUndefined();
    const url: string = result.data.createChangePasswordUrl;
    // 再設定画面へ、使い捨てトークン付きで飛ぶ URL であること
    expect(url).toContain('/auth/changePassword?token=');
    expect(url.split('token=')[1]?.length).toBeGreaterThan(20);

    await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${userId}") }`);
  });

  test('【重要】Admin 以外はパスワード再設定 URL を発行できない（#115）', async ({
    page,
    browser,
  }) => {
    // この URL は単体でパスワードを変更できる。発行できる人を誤ると
    // 一般利用者が他人のパスワードを掌握できてしまう。
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const email = `non-admin-${Date.now()}@example.com`;
    const password = 'TestPass123!';
    const created = await graphqlQuery(
      page,
      `mutation {
        adminCreateUser(input: { email: "${email}", password: "${password}" }) { id isAdmin }
      }`
    );
    const userId = created.data.adminCreateUser.id;
    expect(created.data.adminCreateUser.isAdmin).toBe(false);

    // 作成した一般ユーザーとして実行する
    const context = await browser.newContext();
    const memberPage = await context.newPage();
    const signInRes = await memberPage.request.post('/api/auth/sign-in', {
      data: { email, password },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(signInRes.ok()).toBe(true);
    await memberPage.goto('/');

    const result = await graphqlQuery(
      memberPage,
      `mutation ($userId: String!, $callbackUrl: String!) {
        createChangePasswordUrl(userId: $userId, callbackUrl: $callbackUrl)
      }`,
      { userId, callbackUrl: 'http://localhost:8080/auth/changePassword' }
    );

    expect(result.errors).toBeDefined();
    expect(result.data?.createChangePasswordUrl).toBeFalsy();

    await context.close();
    await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${userId}") }`);
  });

  test('【重要】Admin がパスワードを再設定でき、それでサインインできる（#115）', async ({
    page,
    browser,
  }) => {
    // パスワードを忘れた利用者の主な復旧経路。mutation が true を返すだけでは
    // 「本当に設定されたか」は分からないため、実際にサインインまで確認する。
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const email = `set-pw-${Date.now()}@example.com`;
    const created = await graphqlQuery(
      page,
      `mutation {
        adminCreateUser(input: { email: "${email}", password: "TestPass123!" }) { id }
      }`
    );
    const userId = created.data.adminCreateUser.id;

    const newPassword = 'AdminIssued456!';
    const result = await graphqlQuery(
      page,
      `mutation ($userId: String!, $password: String!) {
        adminSetUserPassword(userId: $userId, password: $password)
      }`,
      { userId, password: newPassword }
    );
    expect(result.errors).toBeUndefined();
    expect(result.data.adminSetUserPassword).toBe(true);

    const context = await browser.newContext();
    const userPage = await context.newPage();

    // 設定した新しいパスワードでサインインできる
    const okRes = await userPage.request.post('/api/auth/sign-in', {
      data: { email, password: newPassword },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(okRes.ok()).toBe(true);

    // 元のパスワードは使えなくなっている（上書きされたことの確認）
    const ngRes = await userPage.request.post('/api/auth/sign-in', {
      data: { email, password: 'TestPass123!' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(ngRes.ok()).toBe(false);

    await context.close();
    await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${userId}") }`);
  });

  test('【重要】パスワードの再設定で既存セッションが失効する（#115）', async ({
    page,
    browser,
  }) => {
    // 乗っ取られたアカウントを復旧する場面を想定する。ここで攻撃者の
    // セッションが生き残ると、パスワードを変えても居座られる。
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const email = `revoke-pw-${Date.now()}@example.com`;
    const password = 'TestPass123!';
    const created = await graphqlQuery(
      page,
      `mutation {
        adminCreateUser(input: { email: "${email}", password: "${password}" }) { id }
      }`
    );
    const userId = created.data.adminCreateUser.id;

    // 先にサインインしてセッションを作っておく
    const context = await browser.newContext();
    const userPage = await context.newPage();
    const signInRes = await userPage.request.post('/api/auth/sign-in', {
      data: { email, password },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(signInRes.ok()).toBe(true);
    // /api/auth/session は未認証でも 200 を返す（{ user: null }）。
    // ステータスではなく中身を見ないと、失効を検証したことにならない。
    const before = await (await userPage.request.get('/api/auth/session')).json();
    expect(before.user?.email).toBe(email);

    // Admin がパスワードを再設定する
    await graphqlQuery(
      page,
      `mutation ($userId: String!, $password: String!) {
        adminSetUserPassword(userId: $userId, password: $password)
      }`,
      { userId, password: 'AdminIssued456!' }
    );

    // 既存セッションが失効している
    const after = await (await userPage.request.get('/api/auth/session')).json();
    expect(after.user).toBeNull();

    await context.close();
    await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${userId}") }`);
  });

  test('【重要】Admin 以外はパスワードを再設定できない（#115）', async ({
    page,
    browser,
  }) => {
    // 発行できる人を誤ると、一般利用者が他人のアカウントを直接乗っ取れる。
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const email = `non-admin-setpw-${Date.now()}@example.com`;
    const password = 'TestPass123!';
    const created = await graphqlQuery(
      page,
      `mutation {
        adminCreateUser(input: { email: "${email}", password: "${password}" }) { id isAdmin }
      }`
    );
    const userId = created.data.adminCreateUser.id;
    expect(created.data.adminCreateUser.isAdmin).toBe(false);

    const context = await browser.newContext();
    const memberPage = await context.newPage();
    const signInRes = await memberPage.request.post('/api/auth/sign-in', {
      data: { email, password },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(signInRes.ok()).toBe(true);
    await memberPage.goto('/');

    const result = await graphqlQuery(
      memberPage,
      `mutation ($userId: String!, $password: String!) {
        adminSetUserPassword(userId: $userId, password: $password)
      }`,
      { userId, password: 'Hijacked456!' }
    );
    expect(result.errors).toBeDefined();
    expect(result.data?.adminSetUserPassword).toBeFalsy();

    // 拒否されたので、元のパスワードのまま使える
    const stillOk = await memberPage.request.post('/api/auth/sign-in', {
      data: { email, password },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(stillOk.ok()).toBe(true);

    await context.close();
    await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${userId}") }`);
  });

  test('【重要】パスワード変更 URL のトークンは1回で無効になる（#115）', async ({
    page,
    browser,
  }) => {
    // この URL は単体でパスワードを変更できる。使い捨てでないと、
    // 渡したチャットに残った URL で何度でも乗っ取られる。
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const email = `token-reuse-${Date.now()}@example.com`;
    const created = await graphqlQuery(
      page,
      `mutation {
        adminCreateUser(input: { email: "${email}", password: "TestPass123!" }) { id }
      }`
    );
    const userId = created.data.adminCreateUser.id;

    const issued = await graphqlQuery(
      page,
      `mutation ($userId: String!, $callbackUrl: String!) {
        createChangePasswordUrl(userId: $userId, callbackUrl: $callbackUrl)
      }`,
      { userId, callbackUrl: 'http://localhost:8080/auth/changePassword' }
    );
    const token = issued.data.createChangePasswordUrl.split('token=')[1];

    // 未認証の文脈から使う（本来の利用者と同じ状態）
    const context = await browser.newContext();
    const guest = await context.newPage();
    await guest.goto('/');

    const first = await graphqlQuery(
      guest,
      `mutation ($token: String!, $newPassword: String!) {
        changePassword(token: $token, newPassword: $newPassword)
      }`,
      { token, newPassword: 'FirstUse123!' }
    );
    expect(first.errors).toBeUndefined();
    expect(first.data.changePassword).toBe(true);

    // 2回目は拒否される
    const second = await graphqlQuery(
      guest,
      `mutation ($token: String!, $newPassword: String!) {
        changePassword(token: $token, newPassword: $newPassword)
      }`,
      { token, newPassword: 'SecondUse456!' }
    );
    expect(second.errors).toBeDefined();
    expect(second.data?.changePassword).toBeFalsy();
    // エラー名を返すこと。フロントはこれを i18n キー error.<name> に対応づけて
    // 利用者の言語で表示する。生の英語メッセージを出さないための土台。
    expect(second.errors[0].extensions?.name).toBe('INVALID_EMAIL_TOKEN');

    // 2回目のパスワードでサインインできない＝本当に変わっていない
    const ng = await guest.request.post('/api/auth/sign-in', {
      data: { email, password: 'SecondUse456!' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(ng.ok()).toBe(false);

    await context.close();
    await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${userId}") }`);
  });

  test('【重要】CSV を検証しても登録されない（#92）', async ({ page }) => {
    // 2段階にしている意味がここにある。検証で登録されてしまうと、
    // 「確認してから登録する」という前提が崩れる。
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const email = `csv-validate-${Date.now()}@example.com`;
    const csv = `email,name,password\n${email},検証 太郎,CsvPass123!`;

    const result = await graphqlQuery(
      page,
      `mutation ($csv: String!) {
        adminValidateUserCsv(csv: $csv) { okCount ngCount rows { line email ok error } }
      }`,
      { csv }
    );
    expect(result.data.adminValidateUserCsv.okCount).toBe(1);

    // 実際には作られていない
    const list = await graphqlQuery(
      page,
      `query ($search: String!) {
        adminUserList(search: $search) { totalCount }
      }`,
      { search: email }
    );
    expect(list.data.adminUserList.totalCount).toBe(0);
  });

  test('【重要】CSV で複数ユーザーを登録でき、そのパスワードでサインインできる（#92）', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const stamp = Date.now();
    const first = `csv-a-${stamp}@example.com`;
    const second = `csv-b-${stamp}@example.com`;
    const password = 'CsvPass123!';
    const csv = [
      'email,name,password',
      `${first},"山田, 太郎",${password}`,
      `${second},,${password}`,
    ].join('\n');

    const result = await graphqlQuery(
      page,
      `mutation ($csv: String!) {
        adminImportUsers(csv: $csv) { okCount ngCount rows { line email ok error } }
      }`,
      { csv }
    );
    expect(result.errors).toBeUndefined();
    expect(result.data.adminImportUsers.okCount).toBe(2);

    // 登録できたと返ってきただけでは分からないため、実際にサインインする
    const context = await browser.newContext();
    const guest = await context.newPage();
    for (const email of [first, second]) {
      const res = await guest.request.post('/api/auth/sign-in', {
        data: { email, password },
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.ok()).toBe(true);
    }
    await context.close();

    // 後始末
    const list = await graphqlQuery(
      page,
      `query ($search: String!) { adminUserList(search: $search) { items { id } } }`,
      { search: `csv-` + stamp }
    );
    for (const item of list.data.adminUserList.items) {
      await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${item.id}") }`);
    }
  });

  test('【重要】NG 行があっても OK 行は登録される（#92）', async ({ page }) => {
    // 1行の書式ミスで全部やり直しになると、数十行の CSV では運用に耐えない。
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const stamp = Date.now();
    const good = `csv-ok-${stamp}@example.com`;
    const csv = [
      'email,name,password',
      `${good},登録される,CsvPass123!`,
      `bad-email-${stamp},形式不正,CsvPass123!`,
      `csv-weak-${stamp}@example.com,パスワード短い,short`,
      `${good},CSV内で重複,CsvPass123!`,
    ].join('\n');

    const result = await graphqlQuery(
      page,
      `mutation ($csv: String!) {
        adminImportUsers(csv: $csv) { okCount ngCount rows { line email ok error } }
      }`,
      { csv }
    );
    const data = result.data.adminImportUsers;
    expect(data.okCount).toBe(1);
    expect(data.ngCount).toBe(3);

    // 行番号と理由が返ること（これが無いと利用者は CSV を直せない）
    const rows = data.rows;
    expect(rows.map((r: any) => r.line)).toEqual([2, 3, 4, 5]);
    expect(rows[1].error).toContain('形式');
    expect(rows[2].error).toContain('パスワード');
    expect(rows[3].error).toContain('重複');

    const list = await graphqlQuery(
      page,
      `query ($search: String!) { adminUserList(search: $search) { items { id } } }`,
      { search: `csv-` + stamp }
    );
    for (const item of list.data.adminUserList.items) {
      await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${item.id}") }`);
    }
  });

  test('【重要】既存ユーザーは CSV で上書きされない（#92）', async ({
    page,
    browser,
  }) => {
    // CSV の取り違えで既存利用者のパスワードが書き換わると影響が大きい。
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const email = `csv-existing-${Date.now()}@example.com`;
    const original = 'Original123!';
    const created = await graphqlQuery(
      page,
      `mutation {
        adminCreateUser(input: { email: "${email}", password: "${original}" }) { id }
      }`
    );
    const userId = created.data.adminCreateUser.id;

    const csv = `email,name,password\n${email},上書きしたい,Overwritten456!`;
    const result = await graphqlQuery(
      page,
      `mutation ($csv: String!) {
        adminImportUsers(csv: $csv) { okCount ngCount rows { ok error } }
      }`,
      { csv }
    );
    expect(result.data.adminImportUsers.okCount).toBe(0);
    expect(result.data.adminImportUsers.rows[0].error).toContain('すでに登録');

    const context = await browser.newContext();
    const guest = await context.newPage();
    // 元のパスワードのまま
    const ok = await guest.request.post('/api/auth/sign-in', {
      data: { email, password: original },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(ok.ok()).toBe(true);
    // CSV のパスワードでは入れない
    const ng = await guest.request.post('/api/auth/sign-in', {
      data: { email, password: 'Overwritten456!' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(ng.ok()).toBe(false);
    await context.close();

    await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${userId}") }`);
  });

  test('CSV の書式エラーは全体の失敗として返る（#92）', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const result = await graphqlQuery(
      page,
      `mutation ($csv: String!) {
        adminValidateUserCsv(csv: $csv) { okCount }
      }`,
      { csv: 'mail,password\na@example.com,CsvPass123!' }
    );
    expect(result.errors).toBeDefined();
    expect(result.errors[0].message).toContain('email');
  });

  test('【重要】管理操作が監査ログに記録される（#90）', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const email = `audit-target-${Date.now()}@example.com`;
    const created = await graphqlQuery(
      page,
      `mutation {
        adminCreateUser(input: { email: "${email}", password: "TestPass123!" }) { id }
      }`
    );
    const userId = created.data.adminCreateUser.id;

    // 記録は成功後に非同期で書かれるため、現れるまで待つ
    await expect
      .poll(
        async () => {
          const result = await graphqlQuery(
            page,
            `query { adminAuditLogs(action: "user.create", take: 20) {
              items { action actorEmail targetId detail }
            } }`
          );
          return result.data.adminAuditLogs.items.some(
            (i: any) => i.targetId === userId
          );
        },
        { timeout: 15_000 }
      )
      .toBe(true);

    await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${userId}") }`);
  });

  test('【重要】監査ログにパスワードが残らない（#90）', async ({ page }) => {
    // 引数をそのまま記録すると、パスワードを保存しない設計が意味を失う
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const email = `audit-secret-${Date.now()}@example.com`;
    const password = 'SuperSecret999!';
    const created = await graphqlQuery(
      page,
      `mutation {
        adminCreateUser(input: { email: "${email}", password: "${password}" }) { id }
      }`
    );
    const userId = created.data.adminCreateUser.id;

    await expect
      .poll(
        async () => {
          const result = await graphqlQuery(
            page,
            `query { adminAuditLogs(action: "user.", take: 50) { items { detail } } }`
          );
          return JSON.stringify(result.data.adminAuditLogs.items);
        },
        { timeout: 15_000 }
      )
      .not.toContain(password);

    await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${userId}") }`);
  });

  test('【重要】Admin 以外による管理操作の試行が記録される（#90）', async ({
    page,
    browser,
  }) => {
    // Guard の拒否は Interceptor に届かない。ここが記録されないと
    // 「誰が管理操作を試みたか」が永久に分からない（#117 の土台）
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const email = `audit-denied-${Date.now()}@example.com`;
    const password = 'TestPass123!';
    const created = await graphqlQuery(
      page,
      `mutation {
        adminCreateUser(input: { email: "${email}", password: "${password}" }) { id }
      }`
    );
    const userId = created.data.adminCreateUser.id;

    const context = await browser.newContext();
    const memberPage = await context.newPage();
    await memberPage.request.post('/api/auth/sign-in', {
      data: { email, password },
      headers: { 'Content-Type': 'application/json' },
    });
    await memberPage.goto('/');
    // 一般利用者が管理操作を試みる（拒否される）
    await graphqlQuery(memberPage, `query { adminUserList { totalCount } }`);
    await context.close();

    await expect
      .poll(
        async () => {
          const result = await graphqlQuery(
            page,
            `query { adminAuditLogs(action: "admin.denied", take: 20) {
              items { actorEmail detail }
            } }`
          );
          return result.data.adminAuditLogs.items.some(
            (i: any) => i.actorEmail === email
          );
        },
        { timeout: 15_000 }
      )
      .toBe(true);

    await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${userId}") }`);
  });

  test('【重要】監査ログは Admin 以外が読めない（#90）', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const email = `audit-reader-${Date.now()}@example.com`;
    const password = 'TestPass123!';
    const created = await graphqlQuery(
      page,
      `mutation {
        adminCreateUser(input: { email: "${email}", password: "${password}" }) { id }
      }`
    );
    const userId = created.data.adminCreateUser.id;

    const context = await browser.newContext();
    const memberPage = await context.newPage();
    await memberPage.request.post('/api/auth/sign-in', {
      data: { email, password },
      headers: { 'Content-Type': 'application/json' },
    });
    await memberPage.goto('/');

    const result = await graphqlQuery(
      memberPage,
      `query { adminAuditLogs(take: 5) { totalCount } }`
    );
    expect(result.errors).toBeDefined();
    expect(result.data?.adminAuditLogs).toBeFalsy();

    await context.close();
    await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${userId}") }`);
  });

  test('監査ログを CSV でエクスポートできる（#90）', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const result = await graphqlQuery(
      page,
      `query { adminAuditLogsCsv(action: "user.") }`
    );
    expect(result.errors).toBeUndefined();
    const csv: string = result.data.adminAuditLogsCsv;
    expect(csv.split('\n')[0]).toContain('"日時"');
    // 数式として解釈される値が素通りしていないこと
    expect(csv).not.toMatch(/^"=/m);
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

  test('ユーザー一覧からパスワード変更 URL を発行できる（#115）', async ({ page }) => {
    // ⚠️ この経路が無いと、パスワードを忘れた利用者の復旧手段が
    // 「Admin が GraphQL を手で叩く」しか無くなる（#115 の起票理由）。
    await signIn(page);
    await enterOrCreateWorkspace(page);
    await ensureSidebarOpen(page);

    const avatar = page.locator('[data-testid="sidebar-user-avatar"]');
    await avatar.waitFor({ state: 'attached', timeout: 15_000 });
    await avatar.click({ force: true });
    await page
      .locator('[data-testid="workspace-modal-account-admin-option"]')
      .click();
    await expect(page.locator('[data-testid="setting-modal"]')).toBeVisible({
      timeout: 5_000,
    });

    // ユーザー管理タブ（既定で開いている想定だが、明示的に選ぶ）
    await page.getByText('ユーザー管理', { exact: true }).first().click();

    // 操作はメニューに畳まれている（行に直接並べるとユーザー名が潰れるため）
    const actions = page.locator('[data-testid="admin-user-actions"]').first();
    await actions.waitFor({ state: 'visible', timeout: 15_000 });
    await actions.click();

    const resetButton = page.locator('[data-testid="admin-reset-password"]');
    await resetButton.waitFor({ state: 'visible', timeout: 10_000 });
    await resetButton.click();

    // 発行された URL が画面に出ること（SMTP 未設定でも手渡しできるようにするため）
    const url = page.locator('[data-testid="admin-reset-password-url"]');
    await expect(url).toBeVisible({ timeout: 15_000 });
    await expect(url).toContainText('/auth/changePassword?token=');
  });

  test('ユーザー一覧からパスワードを再設定できる（#115）', async ({
    page,
    browser,
  }) => {
    // パスワード忘れの主な復旧経路。API が通っていても、ボタン・モーダル・
    // i18n キーのいずれかが欠けると利用者には使えない（SSO で実際に起きた）。
    await signIn(page);
    await enterOrCreateWorkspace(page);
    await ensureSidebarOpen(page);

    // 対象となる一般ユーザーを作っておく
    const email = `ui-setpw-${Date.now()}@example.com`;
    const created = await graphqlQuery(
      page,
      `mutation {
        adminCreateUser(input: { email: "${email}", password: "TestPass123!" }) { id }
      }`
    );
    const userId = created.data.adminCreateUser.id;

    const avatar = page.locator('[data-testid="sidebar-user-avatar"]');
    await avatar.waitFor({ state: 'attached', timeout: 15_000 });
    await avatar.click({ force: true });
    await page
      .locator('[data-testid="workspace-modal-account-admin-option"]')
      .click();
    await expect(page.locator('[data-testid="setting-modal"]')).toBeVisible({
      timeout: 5_000,
    });
    await page.getByText('ユーザー管理', { exact: true }).first().click();

    // 一覧はページングされるため、対象ユーザーを絞り込んでから操作する
    await page.locator('[data-testid="admin-user-search"]').fill(email);
    const actions = page.locator('[data-testid="admin-user-actions"]').first();
    await actions.waitFor({ state: 'visible', timeout: 15_000 });
    await actions.click();

    const setButton = page.locator('[data-testid="admin-set-password"]');
    await setButton.waitFor({ state: 'visible', timeout: 10_000 });
    await setButton.click();

    const newPassword = 'UiIssued456!';
    const input = page.locator('[data-testid="admin-set-password-input"]');
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill(newPassword);
    await page.getByRole('button', { name: '再設定する' }).click();

    // 画面が閉じただけでは設定されたか分からないため、実際にサインインして確かめる
    const context = await browser.newContext();
    const userPage = await context.newPage();
    await expect
      .poll(
        async () => {
          const res = await userPage.request.post('/api/auth/sign-in', {
            data: { email, password: newPassword },
            headers: { 'Content-Type': 'application/json' },
          });
          return res.ok();
        },
        { timeout: 15_000 }
      )
      .toBe(true);

    await context.close();
    await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${userId}") }`);
  });

  test('使用済みのパスワード変更 URL を開くと、その場で無効と分かる（#115）', async ({
    page,
    browser,
  }) => {
    // 検証しないと、無効な URL でも入力フォームが出てしまい、
    // 利用者はパスワードを入力して送信するまで気づけない。
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const email = `expired-url-${Date.now()}@example.com`;
    const created = await graphqlQuery(
      page,
      `mutation {
        adminCreateUser(input: { email: "${email}", password: "TestPass123!" }) { id }
      }`
    );
    const userId = created.data.adminCreateUser.id;

    const issued = await graphqlQuery(
      page,
      `mutation ($userId: String!, $callbackUrl: String!) {
        createChangePasswordUrl(userId: $userId, callbackUrl: $callbackUrl)
      }`,
      { userId, callbackUrl: 'http://localhost:8080/auth/changePassword' }
    );
    const url: string = issued.data.createChangePasswordUrl;
    const token = url.split('token=')[1];

    const context = await browser.newContext();
    const guest = await context.newPage();
    await guest.goto('/');

    // まだ使っていない URL では、入力フォームが出る
    await guest.goto(`/auth/changePassword?token=${token}`);
    await expect(
      guest.locator('input[type="password"]').first()
    ).toBeVisible({ timeout: 15_000 });

    // 使う
    const used = await graphqlQuery(
      guest,
      `mutation ($token: String!, $newPassword: String!) {
        changePassword(token: $token, newPassword: $newPassword)
      }`,
      { token, newPassword: 'FirstUse123!' }
    );
    expect(used.data.changePassword).toBe(true);

    // 使用済みの URL では、フォームではなく案内が出る
    await guest.goto(`/auth/changePassword?token=${token}`);
    await expect(guest.locator('body')).toContainText(
      'この URL は使用できません',
      { timeout: 15_000 }
    );
    await expect(guest.locator('input[type="password"]')).toHaveCount(0);

    await context.close();
    await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${userId}") }`);
  });

  test('画面から CSV を選ぶと検証結果が出て、登録できる（#92）', async ({
    page,
    browser,
  }) => {
    // API が通っていても、ボタン・ファイル選択・i18n のどれかが欠けると使えない。
    await signIn(page);
    await enterOrCreateWorkspace(page);
    await ensureSidebarOpen(page);

    const avatar = page.locator('[data-testid="sidebar-user-avatar"]');
    await avatar.waitFor({ state: 'attached', timeout: 15_000 });
    await avatar.click({ force: true });
    await page
      .locator('[data-testid="workspace-modal-account-admin-option"]')
      .click();
    await expect(page.locator('[data-testid="setting-modal"]')).toBeVisible({
      timeout: 5_000,
    });
    await page.getByText('ユーザー管理', { exact: true }).first().click();

    await page.locator('[data-testid="admin-csv-import-toggle"]').click();

    const stamp = Date.now();
    const email = `csv-ui-${stamp}@example.com`;
    const password = 'CsvPass123!';
    await page.locator('[data-testid="admin-csv-file"]').setInputFiles({
      name: 'users.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        `email,name,password\n${email},画面 太郎,${password}\nbad-${stamp},形式不正,${password}\n`,
        'utf-8'
      ),
    });

    // 検証結果（OK 1件 / NG 1件）が出る
    const rows = page.locator('[data-testid="admin-csv-rows"]');
    await expect(rows).toBeVisible({ timeout: 15_000 });
    await expect(rows).toContainText('OK');
    await expect(rows).toContainText('NG');
    await expect(rows).toContainText('2行目');

    // この時点ではまだ登録されていない
    const before = await graphqlQuery(
      page,
      `query ($search: String!) { adminUserList(search: $search) { totalCount } }`,
      { search: email }
    );
    expect(before.data.adminUserList.totalCount).toBe(0);

    await page.locator('[data-testid="admin-csv-import"]').click();

    // 登録され、そのパスワードでサインインできる
    const context = await browser.newContext();
    const guest = await context.newPage();
    await expect
      .poll(
        async () => {
          const res = await guest.request.post('/api/auth/sign-in', {
            data: { email, password },
            headers: { 'Content-Type': 'application/json' },
          });
          return res.ok();
        },
        { timeout: 20_000 }
      )
      .toBe(true);
    await context.close();

    const list = await graphqlQuery(
      page,
      `query ($search: String!) { adminUserList(search: $search) { items { id } } }`,
      { search: `csv-ui-` + stamp }
    );
    for (const item of list.data.adminUserList.items) {
      await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${item.id}") }`);
    }
  });

  test('監査ログ画面が開き、記録と詳細が見られる（#90）', async ({ page }) => {
    // API が通っていても、タブ・一覧・詳細のどれかが欠けると使えない
    await signIn(page);
    await enterOrCreateWorkspace(page);
    await ensureSidebarOpen(page);

    // 記録を1件作っておく
    const email = `audit-ui-${Date.now()}@example.com`;
    const created = await graphqlQuery(
      page,
      `mutation {
        adminCreateUser(input: { email: "${email}", password: "TestPass123!" }) { id }
      }`
    );
    const userId = created.data.adminCreateUser.id;

    const avatar = page.locator('[data-testid="sidebar-user-avatar"]');
    await avatar.waitFor({ state: 'attached', timeout: 15_000 });
    await avatar.click({ force: true });
    await page
      .locator('[data-testid="workspace-modal-account-admin-option"]')
      .click();
    await expect(page.locator('[data-testid="setting-modal"]')).toBeVisible({
      timeout: 5_000,
    });

    await page.locator('[data-testid="admin-audit-trigger"]').click();

    const list = page.locator('[data-testid="audit-log-list"]');
    await expect(list).toBeVisible({ timeout: 15_000 });
    // 操作名は利用者の言語で表示する。生の action 名（user.create）を
    // 期待値にすると、日本語化した時点で「機能は正しいのに落ちる」テストになる
    await expect(list).toContainText('ユーザー作成', { timeout: 15_000 });

    // 実行者で絞り込める
    await page.locator('[data-testid="audit-filter-actor"]').fill('e2e-test');
    await expect(list).toContainText('e2e-test@ofuro-wiki.local', {
      timeout: 15_000,
    });

    // 行をクリックすると詳細が出る
    await list.locator('div').filter({ hasText: 'ユーザー作成' }).first().click();
    await expect(page.locator('[data-testid="audit-detail"]')).toBeVisible({
      timeout: 10_000,
    });

    await graphqlQuery(page, `mutation { adminDeleteUser(userId: "${userId}") }`);
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
