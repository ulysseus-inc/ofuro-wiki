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

  // UI サインインと同じ後始末（所有WSへの移動・初期化完了待ち）を行う。
  // ここを省くと、初期化途中のワークスペースを残したままテストが終わり、
  // 以降の実行が巻き添えで壊れる。
  await enterOrCreateWorkspace(page);
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
  if (!page.url().includes('/workspace/')) {
    // サインイン後の自動遷移（ワークスペース自動作成含む）を待機
    await page.waitForURL(/\/workspace\//, { timeout: 30_000 });
  }
  await dismissDevOverlay(page);

  // ⚠️ 自動遷移先が **読み取り専用のマニュアルWS**（#72）になることがある。
  // そのWSでは新規ページを作れず（ボタンが存在しない）、サイドバーの待機や
  // ドキュメント作成が軒並み失敗する。自分が Owner のWSへ移動しておく。
  const ownedId = await getOwnedWorkspaceId(page);
  if (ownedId && !page.url().includes(ownedId)) {
    await page.goto(`/workspace/${ownedId}/all`);
    await page.waitForURL(new RegExp(`/workspace/${ownedId}`), { timeout: 30_000 });
    await dismissDevOverlay(page);
  }

  await waitForWorkspaceInitialized(page);
}

/**
 * ワークスペースが**使える状態**になるまで待つ（サイドバーの描画完了を目印にする）。
 *
 * ⚠️ これを待たずにテストを終えると、**壊れたワークスペースが残る**。
 *
 * サインイン時に自分のワークスペースが無いと、フロントが作成し初期コンテンツを
 * 書き込む。この書き込みには数秒かかるため、途中でブラウザが閉じられると
 * 「行はあるが中身が空」のワークスペースがサーバーに残る。
 * 一度そうなると、そのユーザーは以後サインインするたびにそれを開かされ、
 * 画面はスケルトンのまま（エラーも出ない）で何もできなくなる。
 * 後続のテストが巻き添えで落ちるので、ここで完了を待ち切る。
 */
export async function waitForWorkspaceInitialized(page: Page) {
  const ready = page.locator(
    '[data-testid="sidebar-new-page-button"], [data-testid="sidebar-new-page-with-ask-button"]'
  );
  await ready.first().waitFor({ state: 'visible', timeout: 60_000 });
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

  // それでも表示されない場合はリロードして再試行する。
  //
  // ⚠️ nbstore は SharedWorker（オリジン共有）で動くため、直前のテストの
  // ページが同期の途中で閉じると、後続のページが「Syncing...」のまま
  // サイドバーを描画できないことがある（1ファイル内で何度もサインインする
  // テストで出やすい）。リロードで接続を張り直せば復帰するので、
  // 1回で駄目なら少し待って繰り返す。
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.reload();
    await dismissDevOverlay(page);
    if (await sidebar.first().isVisible({ timeout: 30_000 }).catch(() => false)) return;
    await page.waitForTimeout(2_000);
  }

  // 3回試しても出ない場合は、想定外の状態なので失敗させる
  await sidebar.first().waitFor({ state: 'visible', timeout: 30_000 });
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

/**
 * 自分が Owner のワークスペースIDを取得する。
 *
 * `workspaces` には**マニュアル専用ワークスペース**（全ユーザーが Reader として
 * 自動参加する読み取り専用WS・#72）も含まれる。しかもこれは「WS一覧を取得した
 * タイミング」で参加させる実装のため、E2E でワークスペースを作り直した直後は
 * **先頭に来る**。先頭を無条件に使うと読み取り専用WSを掴んで 403 になる。
 */
export async function getOwnedWorkspaceId(page: Page): Promise<string | undefined> {
  const result = await graphqlQuery(page, '{ workspaces { id permission } }');
  const workspaces: Array<{ id: string; permission: string }> =
    result?.data?.workspaces ?? [];
  return workspaces.find(ws => ws.permission === 'Owner')?.id;
}
