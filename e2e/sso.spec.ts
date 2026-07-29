/**
 * ofuro-wiki シングルサインオン（OIDC）E2E テスト — #89
 *
 * 前提条件:
 *   - PostgreSQL・バックエンド(3010)・フロントエンド(8080) が起動済み
 *   - **開発用 Keycloak が起動済み**
 *       docker compose --profile dev up -d keycloak
 *     （未起動の場合、これらのテストは失敗ではなく skip されます）
 *
 * 実行方法:
 *   cd e2e && BASE_URL=http://localhost:8080 npx playwright test sso.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';
import { TEST_USER, ensureTestUser, signInViaAPI, graphqlQuery } from './helpers';

const BACKEND_URL = 'http://localhost:3010';
const KEYCLOAK_ISSUER = 'http://localhost:8081/realms/ofuro';

/** docker/keycloak/realm-export.json で定義しているテストユーザー */
/** 管理画面で設定するボタン文言（既定文言が使われていないことの確認に使う） */
const BUTTON_LABEL = 'Keycloak でサインイン';

const IDP_USER = {
  email: 'sso-user@example.invalid',
  password: 'SsoTestPass123!',
};

/** 開発用 Keycloak が起動しているか */
async function isKeycloakUp(): Promise<boolean> {
  try {
    const res = await fetch(
      `${KEYCLOAK_ISSUER}/.well-known/openid-configuration`,
      { signal: AbortSignal.timeout(3_000) }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Admin として OIDC 設定を書き換える */
async function updateOidcConfig(page: Page, input: Record<string, unknown>) {
  return graphqlQuery(
    page,
    `mutation ($input: UpdateOidcConfigInput!) {
      updateOidcConfig(input: $input) {
        enabled issuer clientId clientSecretSet autoCreateUser redirectUri
      }
    }`,
    { input }
  );
}

/**
 * サインイン画面を開き、SSO ボタンが描画されるまで待つ。
 *
 * サーバー設定（oauthProviders）を取得してから描画されるため、
 * 固定待機ではなくボタンの出現を待つ。
 */
async function openSignInWithSso(page: Page) {
  await page.goto('/sign-in');
  // ⚠️ 既定文言（Continue with OIDC）で探さない。管理画面で設定した文言が
  // 実際に使われることまで含めて確認する（設定が無視されていた不具合がある）。
  const button = page.getByRole('button', { name: BUTTON_LABEL });
  await button.waitFor({ state: 'visible', timeout: 30_000 });
  return button;
}

/** 検証で作成された利用者を消す（テスト間の独立性を保つ） */
async function deleteIdpUser(page: Page) {
  const list = await graphqlQuery(
    page,
    `query ($search: String) { adminUserList(search: $search, take: 20) { items { id email } } }`,
    { search: IDP_USER.email }
  );
  const target = list?.data?.adminUserList?.items?.find(
    (u: any) => u.email === IDP_USER.email
  );
  if (target) {
    await graphqlQuery(
      page,
      `mutation ($id: String!) { adminDeleteUser(userId: $id) }`,
      { id: target.id }
    );
  }
}

test.describe('シングルサインオン（OIDC）', () => {
  test.describe.configure({ mode: 'serial' });

  let keycloakUp = false;

  test.beforeAll(async () => {
    await ensureTestUser(BACKEND_URL);
    keycloakUp = await isKeycloakUp();
  });

  test.beforeEach(async ({ page }) => {
    test.skip(
      !keycloakUp,
      '開発用 Keycloak が起動していないためスキップ（docker compose --profile dev up -d keycloak）'
    );
    await signInViaAPI(page);
  });

  test('設定前は SSO ボタンが表示されない（#89）', async ({ page }) => {
    await updateOidcConfig(page, { enabled: false });

    const config = await graphqlQuery(page, '{ serverConfig { oauthProviders } }');
    expect(config.data.serverConfig.oauthProviders).toEqual([]);
  });

  test('管理画面から設定でき、リダイレクトURIが示される（#89）', async ({ page }) => {
    const result = await updateOidcConfig(page, {
      enabled: true,
      issuer: KEYCLOAK_ISSUER,
      clientId: 'ofuro-wiki',
      clientSecret: 'dev-client-secret',
      buttonLabel: BUTTON_LABEL,
      autoCreateUser: false,
    });

    const config = result.data.updateOidcConfig;
    expect(config.enabled).toBe(true);
    // ⚠️ シークレットの値そのものは返さない（設定済みかどうかだけ）
    expect(config.clientSecretSet).toBe(true);
    expect(JSON.stringify(result)).not.toContain('dev-client-secret');
    // IdP に登録する値。/api/ は付かない
    expect(config.redirectUri).toContain('/oauth/callback');
    expect(config.redirectUri).not.toContain('/api/oauth/callback');
  });

  test('接続テストで IdP との疎通を確認できる（#89）', async ({ page }) => {
    const result = await graphqlQuery(
      page,
      `mutation ($issuer: String!) {
        testOidcConnection(issuer: $issuer) { ok message issuer authorizationEndpoint }
      }`,
      { issuer: KEYCLOAK_ISSUER }
    );

    expect(result.data.testOidcConnection.ok).toBe(true);
    expect(result.data.testOidcConnection.issuer).toBe(KEYCLOAK_ISSUER);
  });

  test('設定すると SSO ボタンが表示される（#89）', async ({ page, browser }) => {
    const config = await graphqlQuery(
      page,
      '{ serverConfig { features oauthProviders oidcButtonLabel } }'
    );
    expect(config.data.serverConfig.oauthProviders).toContain('OIDC');
    expect(config.data.serverConfig.features).toContain('OAuth');
    expect(config.data.serverConfig.oidcButtonLabel).toBe(BUTTON_LABEL);

    // 設定した文言がボタンに実際に出ること（未サインインの画面で確認する）
    const context = await browser.newContext();
    const signInPage = await context.newPage();
    await openSignInWithSso(signInPage);
    await context.close();
  });

  test('【重要】自動作成が無効なら、未登録の利用者はサインインできない（#89）', async ({
    page,
    browser,
  }) => {
    await updateOidcConfig(page, { autoCreateUser: false });
    await deleteIdpUser(page);

    // ⚠️ Admin の認証クッキーが付いたコンテキストでは /sign-in がワークスペースへ
    //    転送されてしまうため、未サインインの別コンテキストで確認する
    const context = await browser.newContext();
    const signInPage = await context.newPage();
    const ssoButton = await openSignInWithSso(signInPage);

    const popupPromise = context.waitForEvent('page', { timeout: 30_000 });
    await ssoButton.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');

    await popup.fill('#username', IDP_USER.email);
    await popup.fill('#password', IDP_USER.password);
    const popupClosed = popup.waitForEvent('close', { timeout: 30_000 });
    await popup.click('#kc-login');

    // 失敗してもポップアップを残さない。
    // 残すとサインイン画面（＝SSO ボタン）が並び、押すたびに窓が増える。
    await popupClosed;

    // IdP の認証は通るが、こちら側でアカウントが無いため拒否される。
    //
    // ⚠️ 「エラーになったこと」だけを見てはいけない。state 不一致など**別の理由**で
    // 失敗しても通ってしまい、肝心の「アカウントが無いから拒否した」ことを
    // 確かめられない（実際にそれで不具合を見逃した）。理由まで検証する。
    await expect(signInPage.getByText(/アカウントがありません/)).toBeVisible({
      timeout: 15_000,
    });

    // アカウントが作られていないこと
    const list = await graphqlQuery(
      page,
      `query ($search: String) { adminUserList(search: $search, take: 20) { items { email } } }`,
      { search: IDP_USER.email }
    );
    expect(list.data.adminUserList.items).toHaveLength(0);

    await signInPage.close();
    await context.close();
  });

  test('自動作成を有効にすると SSO でサインインできる（#89）', async ({
    page,
    browser,
  }) => {
    await updateOidcConfig(page, { autoCreateUser: true });

    // 未サインインの別コンテキストで、実際の利用者と同じ経路をたどる
    const context = await browser.newContext();
    const signInPage = await context.newPage();
    const ssoButton = await openSignInWithSso(signInPage);

    const popupPromise = context.waitForEvent('page', { timeout: 30_000 });
    await ssoButton.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');

    await popup.fill('#username', IDP_USER.email);
    await popup.fill('#password', IDP_USER.password);
    await popup.click('#kc-login');
    // 成功時はポップアップが自分で閉じる
    await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => {});

    // アカウントが作成されていること
    const list = await graphqlQuery(
      page,
      `query ($search: String) { adminUserList(search: $search, take: 20) { items { email } } }`,
      { search: IDP_USER.email }
    );
    expect(list.data.adminUserList.items.map((u: any) => u.email)).toContain(
      IDP_USER.email
    );

    await signInPage.close();
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!keycloakUp) return;
    // 後片付け: 検証で作られた利用者を消し、設定を無効に戻す
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInViaAPI(page);
      await deleteIdpUser(page);
      await updateOidcConfig(page, { enabled: false, autoCreateUser: false });
    } catch {
      // 後片付けの失敗はテスト結果に影響させない
    } finally {
      await page.close();
      await context.close();
    }
  });
});
