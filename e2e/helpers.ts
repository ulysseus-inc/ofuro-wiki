import { type Page, expect } from '@playwright/test';

/** テスト用ユーザー情報 */
export const TEST_USER = {
  email: 'e2e-test@ofuro-wiki.local',
  password: 'E2eTestPass123!',
};

/** バックエンドAPI経由でテストユーザーを作成（既存なら sign-in）し、既存ワークスペースを全削除 */
export async function ensureTestUser(baseURL: string) {
  let res = await fetch(`${baseURL}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: TEST_USER.email,
      password: TEST_USER.password,
    }),
  });

  // ユーザーが存在しない場合はサインアップ
  if (res.status === 401 || res.status === 404) {
    res = await fetch(`${baseURL}/api/auth/sign-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: TEST_USER.email,
        password: TEST_USER.password,
      }),
    });
  }

  if (!res.ok) {
    throw new Error(`Failed to ensure test user: ${res.status} ${await res.text()}`);
  }

  // 認証クッキーを取得
  const cookies = res.headers.getSetCookie?.() ?? [];
  const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');

  // 現在のユーザー ID を取得
  const meRes = await fetch(`${baseURL}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify({ query: '{ currentUser { id } }' }),
  });
  const meData = await meRes.json();
  const myUserId: string | undefined = meData?.data?.currentUser?.id;

  // 既存ワークスペースを全削除/脱退（空のワークスペースが残るとサイドバーが読み込めない）
  const listRes = await fetch(`${baseURL}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    },
    body: JSON.stringify({ query: '{ workspaces { id owner { id } } }' }),
  });
  if (listRes.ok) {
    const data = await listRes.json();
    const workspaces: { id: string; owner: { id: string } }[] = data?.data?.workspaces ?? [];
    for (const ws of workspaces) {
      const isOwner = !myUserId || ws.owner?.id === myUserId;
      if (isOwner) {
        // オーナーなら削除
        await fetch(`${baseURL}/graphql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
          body: JSON.stringify({
            query: `mutation { deleteWorkspace(id: "${ws.id}") }`,
          }),
        });
      } else {
        // メンバーとして参加しているだけなら脱退
        await fetch(`${baseURL}/graphql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
          body: JSON.stringify({
            query: `mutation { leaveWorkspace(workspaceId: "${ws.id}") }`,
          }),
        });
      }
    }
  }
}

/**
 * API 経由でサインインしてワークスペースに到達する（UIフォーム入力なし・高速版）
 * 複数コンテキストを使うテスト等で UI サインインの待機時間を節約する
 */
export async function signInViaAPI(page: Page) {
  // REST API でサインイン（ブラウザコンテキストのクッキーにセットされる）
  const res = await page.request.post('/api/auth/sign-in', {
    data: { email: TEST_USER.email, password: TEST_USER.password },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) {
    throw new Error(`API sign-in failed: ${res.status()} ${await res.text()}`);
  }
  // ルートへ移動 → クッキーを使って自動的にワークスペースへリダイレクト
  await page.goto('/');
  await page.waitForURL(/\/workspace\//, { timeout: 30_000 });
  // Yjs SharedWorker の接続を確立し直す
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/workspace\//, { timeout: 30_000 });
}

/** webpack dev server の overlay iframe を除去する */
export async function dismissDevOverlay(page: Page) {
  await page.evaluate(() => {
    const iframe = document.getElementById('webpack-dev-server-client-overlay');
    if (iframe) iframe.remove();
  });
}

/** サインインしてワークスペースに到達するまで待機 */
export async function signIn(page: Page) {
  await page.goto('/');
  await dismissDevOverlay(page);
  // メール入力（日本語UIのplaceholder: 「メールアドレスを入力してください」）
  await page.locator('input[placeholder*="メールアドレス"], input[placeholder*="email"]').fill(TEST_USER.email);
  await page.locator('button:has-text("続行"), button:has-text("Continue")').click();
  // パスワード入力
  await page.locator('input[type="password"]').waitFor({ state: 'visible' });
  await page.locator('input[type="password"]').fill(TEST_USER.password);
  await page.locator('button:has-text("サインイン"), button:has-text("Sign in")').click();
  // シングルワークスペース: サインイン後、自動的にワークスペースに遷移する
  // （ワークスペースが無い場合は自動作成される）
  await page.waitForURL(/\/workspace\//, { timeout: 30_000 });
  // nbstore は SharedWorker（オリジン共有）のため、直前の独立ページ（認証テスト等）が
  // メッセージチャンネルを未完了のまま閉じると SharedWorker が不整合状態になる。
  // リロードで新しい接続を確立し直すことでサイドバーの Yjs 初期化を保証する。
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/workspace\//, { timeout: 30_000 });
}

/**
 * ワークスペース内にいることを保証する。
 * シングルワークスペースモード: signIn() で自動遷移済みのはずなので、
 * 既にワークスペース内にいるならスキップ、いなければ待機する。
 */
export async function enterOrCreateWorkspace(page: Page) {
  if (page.url().includes('/workspace/')) {
    await dismissDevOverlay(page);
    return;
  }

  // サインイン後の自動遷移（ワークスペース自動作成含む）を待機
  await page.waitForURL(/\/workspace\//, { timeout: 30_000 });
  await dismissDevOverlay(page);
}

/** GraphQL クエリを実行して結果を返す */
export async function graphqlQuery(page: Page, query: string, variables?: Record<string, any>) {
  return page.evaluate(async ({ q, v }: { q: string; v?: Record<string, any> }) => {
    const body: any = { query: q };
    if (v) body.variables = v;
    const res = await fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    return res.json();
  }, { q: query, v: variables });
}

/** サイドバーが表示されていることを確認し、非表示ならトグルする */
export async function ensureSidebarOpen(page: Page) {
  await dismissDevOverlay(page);
  // 「+」ボタンはモード設定によって2種類ある
  // サーバー起動直後は Yjs 同期に時間がかかるためタイムアウトを長めに取る
  const sidebar = page.locator(
    '[data-testid="sidebar-new-page-button"], [data-testid="sidebar-new-page-with-ask-button"]'
  );
  if (await sidebar.first().isVisible({ timeout: 60_000 }).catch(() => false)) return;

  // 左上のトグルボタンをクリック
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const toggle = btns.find(
      b =>
        b.querySelector('svg') &&
        b.getBoundingClientRect().x < 50 &&
        b.getBoundingClientRect().y < 50
    );
    toggle?.click();
  });
  if (await sidebar.first().isVisible({ timeout: 30_000 }).catch(() => false)) return;

  // それでも表示されない場合はページをリロードして再試行
  await page.reload();
  await dismissDevOverlay(page);
  await sidebar.first().waitFor({ state: 'visible', timeout: 60_000 });
}

/** 新規ページを作成する（ボタンのモードを自動判定） */
export async function createNewPage(page: Page) {
  const withAsk = page.locator('[data-testid="sidebar-new-page-with-ask-button"]');
  const simple = page.locator('[data-testid="sidebar-new-page-button"]');

  if (await withAsk.isVisible({ timeout: 1_000 }).catch(() => false)) {
    // ドロップダウンメニューを開いて「Page」をクリック
    await withAsk.click();
    await page.waitForTimeout(500);
    await page.locator('div[role="menuitem"]:has-text("Page")').first().click();
  } else {
    await simple.click();
  }
}
