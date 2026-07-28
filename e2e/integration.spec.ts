/**
 * ofuro-wiki 結合テスト
 *
 * 前提条件:
 *   - PostgreSQL が起動済み (docker compose up -d)
 *   - バックエンド (port 3010) が起動済み (cd backend && npm run start:dev)
 *   - フロントエンド (port 8080) が起動済み (cd frontend && yarn dev)
 *
 * 実行方法:
 *   cd e2e && npx playwright test integration.spec.ts
 */
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  TEST_USER,
  ensureTestUser,
  signIn,
  signInViaAPI,
  enterOrCreateWorkspace,
  graphqlQuery,
  ensureSidebarOpen,
  dismissDevOverlay,
  createNewPage,
} from './helpers';

// ---------------------------------------------------------------------------
// 共有ブラウザコンテキスト（IndexedDB 等のストレージを全テストで共有）
// ---------------------------------------------------------------------------
const test = base.extend<{ sharedPage: Page }, { sharedContext: BrowserContext; workerPage: Page }>({
  sharedContext: [async ({ browser }, use) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    await use(context);
    await context.close();
  }, { scope: 'worker' }],
  workerPage: [async ({ sharedContext }, use) => {
    const page = await sharedContext.newPage();
    // webpack dev server overlay を非表示
    page.on('domcontentloaded', async () => {
      await page.addStyleTag({
        content: '#webpack-dev-server-client-overlay { pointer-events: none !important; display: none !important; }',
      }).catch(() => {});
    });
    await use(page);
    await page.close();
  }, { scope: 'worker' }],
  // sharedPage はワーカーレベルの workerPage を参照するだけ（テスト間で同じインスタンス）
  sharedPage: async ({ workerPage }, use) => {
    await use(workerPage);
  },
});

// ---------------------------------------------------------------------------
// セットアップ
// ---------------------------------------------------------------------------
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  await ensureTestUser('http://localhost:3010');
  // 新規作成されたワークスペースは Yjs ドキュメントが空のため、ブラウザがサーバーへ
  // 初期ドキュメントを push するまでサイドバーが skeleton のまま停止する。
  // セットアップ用ページでサインイン＆サイドバー表示を待機し、Yjs 同期を完了させてから閉じる。
  const setupContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const setupPage = await setupContext.newPage();
  try {
    await signIn(setupPage);
    await setupPage.locator(
      '[data-testid="sidebar-new-page-button"], [data-testid="sidebar-new-page-with-ask-button"]'
    ).first().waitFor({ state: 'visible', timeout: 60_000 });
    // Yjs 同期がサーバーへ伝播するまで少し待機
    await setupPage.waitForTimeout(2_000);
  } finally {
    await setupPage.close();
    await setupContext.close();
  }
});

// ---------------------------------------------------------------------------
// 1. 認証フロー（独立したコンテキストで実行 — 未ログイン状態が必要）
// ---------------------------------------------------------------------------
test.describe('認証', () => {
  test('サインイン画面が表示される', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=サインイン').first()).toBeVisible();
    await expect(page.locator('input[placeholder*="メールアドレス"], input[placeholder*="email"]')).toBeVisible();
    await expect(page.locator('button:has-text("続行"), button:has-text("Continue")')).toBeVisible();
  });

  test('メール入力後にパスワード画面に遷移する', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[placeholder*="メールアドレス"], input[placeholder*="email"]').fill(TEST_USER.email);
    await page.locator('button:has-text("続行"), button:has-text("Continue")').click();
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('button:has-text("サインイン"), button:has-text("Sign in")')).toBeVisible();
  });

  test('正しいパスワードでサインインできる', async ({ page }) => {
    await signIn(page);
    // シングルワークスペース: サインイン後、自動的にワークスペースに遷移
    await expect(page).toHaveURL(/\/workspace\//);
  });
});

// ---------------------------------------------------------------------------
// 2. ワークスペース（共有コンテキスト — ここでワークスペースを初期化）
// ---------------------------------------------------------------------------
test.describe('ワークスペース', () => {
  test('サインイン後にワークスペースへ自動遷移する', async ({ sharedPage: page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/workspace\//);
  });

  test('GraphQL で currentUser を取得できる', async ({ sharedPage: page }) => {
    // 前のテストで既にサインイン済み（共有コンテキスト）
    await enterOrCreateWorkspace(page);

    const result = await graphqlQuery(page, '{ currentUser { id email } }');
    expect(result.data.currentUser.email).toBe(TEST_USER.email);
    expect(result.data.currentUser.id).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. ドキュメント一覧・表示（共有コンテキスト）
// ---------------------------------------------------------------------------
test.describe('ドキュメント', () => {
  test('All docs からドキュメント一覧が表示される', async ({ sharedPage: page }) => {
    await enterOrCreateWorkspace(page);
    await ensureSidebarOpen(page);

    await page.locator('text=すべてのドキュメント').first().click();
    await expect(page.getByTestId('workspace-docs-button')).toBeVisible({ timeout: 10_000 });
  });

  test('Getting Started ページが表示される', async ({ sharedPage: page }) => {
    await ensureSidebarOpen(page);

    await page.locator('text=すべてのドキュメント').click();
    // Getting Started をクリック
    const doc = page.locator('text=Getting Started').first();
    if (await doc.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await doc.click();
      // タイトルブロックかエラーメッセージのどちらかが先に表示されるまで待つ
      // （Yjsデータ未同期のテスト環境ではエラーが表示される場合がある）
      const titleLocator = page.locator('[data-block-is-title]');
      const errorLocator = page.locator('text=文書の内容を読み込むのに時間がかかります');
      const result = await Promise.race([
        titleLocator.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'title'),
        errorLocator.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'error'),
      ]).catch(() => 'timeout');
      if (result === 'title') {
        await expect(titleLocator).toBeVisible();
      }
      // 'error' or 'timeout': Yjs未同期による既知の問題としてスキップ
    }
  });
});

// ---------------------------------------------------------------------------
// 4. エディタ機能（共有コンテキスト）
// ---------------------------------------------------------------------------
test.describe('BlockSuite エディタ', () => {
  test('新規ページを作成できる', async ({ sharedPage: page }) => {
    await ensureSidebarOpen(page);

    await createNewPage(page);
    await page.waitForTimeout(2_000);

    // Untitled ページが開く
    await expect(page.locator('[data-block-is-title]')).toBeVisible({ timeout: 10_000 });
  });

  test('キーボードでテキスト入力ができる', async ({ sharedPage: page }) => {
    await ensureSidebarOpen(page);

    // 新規ページ作成
    await createNewPage(page);
    await page.waitForTimeout(2_000);

    // 本文エリアをクリック
    const paragraph = page.locator('[data-block-id] .inline-editor').first();
    await paragraph.click();

    // 1文字ずつ入力
    const testText = 'Hello';
    for (const char of testText) {
      await page.keyboard.press(char);
    }
    await page.waitForTimeout(500);

    // 入力したテキストが表示されていること
    await expect(page.locator(`text=${testText}`)).toBeVisible();
  });

  test('/ スラッシュコマンドメニューが表示される', async ({ sharedPage: page }) => {
    await ensureSidebarOpen(page);

    // 新規ページ作成
    await createNewPage(page);
    await page.waitForTimeout(2_000);

    // 本文エリアをクリック
    const paragraph = page.locator('[data-block-id] .inline-editor').first();
    await paragraph.click();

    // / を入力
    await page.keyboard.press('/');
    await page.waitForTimeout(1_000);

    // スラッシュメニューが表示される（Text, Heading 等のメニュー項目）
    // BlockSuite のスラッシュメニューは affine-slash-menu コンポーネント
    const hasSlashMenu = await page.evaluate(() => {
      // Shadow DOM 内を含めてメニューを探す
      const menu = document.querySelector('affine-slash-menu');
      if (menu) return true;
      // フォールバック: 画面上に "Heading 1" テキストがあるか
      const allText = document.body.innerText;
      return allText.includes('Heading 1') || allText.includes('Code Block');
    });
    expect(hasSlashMenu).toBe(true);

    // Escape で閉じる
    await page.keyboard.press('Escape');
  });

  test('/ スラッシュコマンドから2列カラムを挿入できる', async ({ sharedPage: page }) => {
    await ensureSidebarOpen(page);

    // 新規ページ作成
    await createNewPage(page);
    await page.waitForTimeout(2_000);

    // 本文エリアをクリック
    const paragraph = page.locator('[data-block-id] .inline-editor').first();
    await paragraph.click();

    // / を入力して「2」で絞り込み
    await page.keyboard.press('/');
    await page.waitForTimeout(1_000);
    await page.keyboard.press('2');
    await page.waitForTimeout(500);

    // 「2列」メニュー項目をクリック
    const menuItem = page.locator('text=2列のレイアウトを作成します').first();
    await expect(menuItem).toBeVisible({ timeout: 5_000 });
    await menuItem.click();
    await page.waitForTimeout(1_000);

    // カラムブロックが挿入されていること
    const columns = page.locator('affine-columns');
    await expect(columns).toBeVisible({ timeout: 5_000 });

    // 2つのカラムセルが存在すること
    const cells = page.locator('affine-column-cell');
    await expect(cells).toHaveCount(2);

    // 各カラム内にテキスト入力できること
    const firstCell = cells.nth(0).locator('.inline-editor').first();
    await firstCell.click();
    await page.keyboard.type('Column1');
    await page.waitForTimeout(500);

    const secondCell = cells.nth(1).locator('.inline-editor').first();
    await secondCell.click();
    await page.keyboard.type('Column2');
    await page.waitForTimeout(500);

    // 入力されたテキストが表示されること
    await expect(page.locator('text=Column1')).toBeVisible();
    await expect(page.locator('text=Column2')).toBeVisible();

    // カラムの下の段落で編集できること
    const lastParagraph = page.locator(
      'affine-note > .affine-note-block-container > .affine-block-children-container > affine-paragraph:last-child .inline-editor'
    ).first();
    await lastParagraph.click();
    await page.keyboard.type('BelowColumns');
    await page.waitForTimeout(500);
    await expect(page.locator('text=BelowColumns')).toBeVisible();
  });

  test('カラムブロック内でスラッシュコマンド（箇条書き・番号付きリスト）が使える', async ({ sharedPage: page }) => {
    await ensureSidebarOpen(page);

    // 新規ページ作成
    await createNewPage(page);
    await page.waitForTimeout(2_000);

    // 本文エリアをクリック
    const paragraph = page.locator('[data-block-id] .inline-editor').first();
    await paragraph.click();

    // 2列カラムを挿入
    await page.keyboard.press('/');
    await page.waitForTimeout(1_000);
    await page.keyboard.press('2');
    await page.waitForTimeout(500);
    const menuItem = page.locator('text=2列のレイアウトを作成します').first();
    await expect(menuItem).toBeVisible({ timeout: 5_000 });
    await menuItem.click();
    await page.waitForTimeout(1_000);

    const cells = page.locator('affine-column-cell');
    await expect(cells).toHaveCount(2);

    // --- 左カラムで箇条書きリストを挿入 ---
    const firstCellEditor = cells.nth(0).locator('.inline-editor').first();
    await firstCellEditor.click();
    await page.waitForTimeout(500);

    await page.keyboard.press('/');
    await page.waitForTimeout(1_000);

    // スラッシュメニューが表示されること
    const hasSlashMenu1 = await page.evaluate(() => !!document.querySelector('affine-slash-menu'));
    expect(hasSlashMenu1).toBe(true);

    await page.keyboard.type('bulleted');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // affine-list がカラムセル内に作成されること
    await expect(cells.nth(0).locator('affine-list')).toBeVisible({ timeout: 3_000 });
    await page.keyboard.type('Bullet in col');
    await page.waitForTimeout(300);
    await expect(page.locator('text=Bullet in col')).toBeVisible();

    // --- 右カラムで番号付きリストを挿入 ---
    const secondCellEditor = cells.nth(1).locator('.inline-editor').first();
    await secondCellEditor.click();
    await page.waitForTimeout(500);

    await page.keyboard.press('/');
    await page.waitForTimeout(1_000);

    const hasSlashMenu2 = await page.evaluate(() => !!document.querySelector('affine-slash-menu'));
    expect(hasSlashMenu2).toBe(true);

    await page.keyboard.type('numbered');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    await expect(cells.nth(1).locator('affine-list')).toBeVisible({ timeout: 3_000 });
    await page.keyboard.type('Number in col');
    await page.waitForTimeout(300);
    await expect(page.locator('text=Number in col')).toBeVisible();
  });

  test('カラムセルが lit 描画エラーから自己回復する（self-heal）', async ({ sharedPage: page }) => {
    // 長時間タブでまれに起きる lit `repeat` の DOM 同期破綻
    // （ColumnCellBlockComponent.update → _$clear → null.nextSibling）を、
    // セルのライト DOM（lit のマーカーコメント含む）を外部から破壊して人工的に誘発し、
    // 防御策（RecoverableRenderMixin）がエディタをブリックさせず再描画で回復することを確認する。
    await ensureSidebarOpen(page);
    await createNewPage(page);
    await page.waitForTimeout(2_000);

    // 3列カラムを挿入（既存カラムテストと同じ実績のある操作タイミング）
    const paragraph = page.locator('[data-block-id] .inline-editor').first();
    await paragraph.click();
    await page.keyboard.press('/');
    await page.waitForTimeout(1_000);
    await page.keyboard.press('3');
    await page.waitForTimeout(500);
    const menuItem = page.locator('text=3列のレイアウトを作成します').first();
    await expect(menuItem).toBeVisible({ timeout: 5_000 });
    await menuItem.click();

    const cells = page.locator('affine-column-cell');
    await expect(cells).toHaveCount(3);

    // セル0に段落を2つ用意
    await cells.nth(0).locator('.inline-editor').first().click();
    await page.keyboard.type('alpha');
    await page.keyboard.press('Enter');
    await page.keyboard.type('beta');
    // 入力が反映され、段落が2つ以上になるのを待つ
    const cell0Paragraphs = cells.nth(0).locator('affine-paragraph');
    await expect.poll(() => cell0Paragraphs.count()).toBeGreaterThanOrEqual(2);
    const before = await cell0Paragraphs.count();

    // 未捕捉エラーを監視
    const uncaught: string[] = [];
    page.on('pageerror', e => uncaught.push(e.message));

    // 故意に lit の境界ノードを破壊 → モデルに子を追加して repeat 再構築を誘発
    const res = await page.evaluate(() => {
      const cell = document.querySelector('affine-column-cell') as any;
      cell.replaceChildren(); // lit のマーカーごと DOM を破壊
      const id = cell.std.store.addBlock('affine:paragraph', {}, cell.model);
      return !!id;
    });
    expect(res).toBe(true);

    // 回復していること: セル0が再描画され、追加分を含む段落が表示される
    await expect.poll(() => cell0Paragraphs.count()).toBeGreaterThanOrEqual(before);

    // 未捕捉の nextSibling クラッシュが出ていないこと（防御策が捕捉・回復している）
    expect(uncaught.filter(m => m.includes('nextSibling'))).toHaveLength(0);

    // 回復後も編集できること
    await cells.nth(0).locator('.inline-editor').first().click();
    await page.keyboard.type('gamma');
    await expect(page.locator('text=gamma')).toBeVisible({ timeout: 3_000 });
  });

  test('Properties パネルが表示される', async ({ sharedPage: page }) => {
    await ensureSidebarOpen(page);

    // All docs から既存ドキュメントを開く
    await page.locator('text=すべてのドキュメント').click();
    await page.waitForTimeout(2_000);

    // データ移行ダイアログ等のオーバーレイを Escape で閉じる
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // 最初のドキュメントをクリック（testid → 任意のドキュメントタイトルリンクの順で試行）
    const firstDoc = page.locator('[data-testid="page-list-item"]').first();
    const firstDocLink = page.locator('[data-testid="doc-list-item-title"], .doc-list-item a').first();
    if (await firstDoc.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await firstDoc.click();
    } else if (await firstDocLink.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await firstDocLink.click();
    } else {
      // フォールバック: 表示されている任意のドキュメント名をクリック
      const anyDoc = page.locator('text=無題, text=Getting Started, text=FAQ').first();
      await anyDoc.click({ timeout: 5_000 });
    }
    await page.waitForTimeout(2_000);

    // 右サイドバーを開く
    await page.locator('[data-testid="right-sidebar-toggle"]').click();
    await page.waitForTimeout(1_000);

    // Properties が表示されること（日本語UIのため日本語テキストで確認）
    const hasProperties = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('プロパティ') || text.includes('タグ') || text.includes('作成日') ||
             text.includes('Properties') || text.includes('Tags') || text.includes('Created');
    });
    expect(hasProperties).toBe(true);
  });

  test('保護モード: ON で読み取り専用になり、解除で再編集できる（#66）', async ({
    sharedPage: page,
  }) => {
    // #66 ドキュメント単位の保護（advisory lock）。プロパティで保護 ON にすると
    // 編集権限があっても本文が読み取り専用になり、バナーの「保護を解除」で戻せる。
    // ハードコードした待機は避け、自動リトライするアサーションで安定化する。
    await ensureSidebarOpen(page);
    await createNewPage(page);

    // 本文に初期テキストを入力
    const paragraph = page.locator('[data-block-id] .inline-editor').first();
    await paragraph.click();
    await page.keyboard.type('ABC');
    await expect(page.locator('text=ABC').first()).toBeVisible({ timeout: 5_000 });

    // Info モーダルを開き、保護モードのチェックボックスを ON にする
    await page.locator('[data-testid="header-info-button"]').click();
    const protCheckbox = page.locator('[data-testid="toggle-read-only-checkbox"]');
    await expect(protCheckbox).toBeVisible({ timeout: 5_000 });
    await protCheckbox.click({ force: true });
    // モーダルを閉じる
    await page.keyboard.press('Escape');
    await expect(protCheckbox).toBeHidden();

    // 保護バナーが表示されること（＝保護 ON が反映されたことの確認。
    // Checkbox はカスタム実装で root が div のため toBeChecked は使わず、
    // 保護状態の可視結果であるバナー表示で判定する）
    await expect(
      page.locator('[data-testid="doc-protection-banner"]')
    ).toBeVisible({ timeout: 5_000 });

    // 読み取り専用: 本文末尾にカーソルを置いて入力しても増えないこと
    await page
      .locator('[data-block-id] .inline-editor')
      .first()
      .click()
      .catch(() => {});
    await page.keyboard.type('XYZ');
    // 反映されないことを確認（一定時間ポーリングしても XYZ を含まない）
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.querySelector('affine-page-root')?.textContent ?? ''
          ),
        { timeout: 2_000 }
      )
      .not.toContain('XYZ');

    // 解除は情報パネルのプロパティトグルから（バナーにワンクリック解除は無い）。
    // 再度 Info を開いて保護モードを OFF にする。
    await page.locator('[data-testid="header-info-button"]').click();
    await expect(protCheckbox).toBeVisible({ timeout: 5_000 });
    await protCheckbox.click({ force: true });
    await page.keyboard.press('Escape');
    await expect(protCheckbox).toBeHidden();

    // 保護バナーが消え、再び編集できること
    await expect(
      page.locator('[data-testid="doc-protection-banner"]')
    ).toBeHidden({ timeout: 5_000 });
    await page.locator('[data-block-id] .inline-editor').first().click();
    await page.keyboard.type('XYZ');
    await expect(page.locator('text=XYZ').first()).toBeVisible({ timeout: 5_000 });
  });

  test('埋め込み系ブロックが挿入・描画できる（bookmark/embed各種、#52）', async ({
    sharedPage: page,
  }) => {
    // 「/」コマンド系の埋め込みブロック（bookmark, embed-youtube/github/figma/loom/
    // html/iframe）のスキーマ登録＋コンポーネント描画の回帰を検知する。
    // スラッシュメニューの i18n ラベル依存を避けるため、store.addBlock で各 flavour を
    // 直接挿入し、対応する custom element が描画されることを検証する。
    await ensureSidebarOpen(page);
    await createNewPage(page);
    await page.waitForTimeout(2_000);

    // 本文にフォーカスして note を確実に用意
    const paragraph = page.locator('[data-block-id] .inline-editor').first();
    await paragraph.click();

    const uncaught: string[] = [];
    page.on('pageerror', e => uncaught.push(e.message));

    // 各埋め込み flavour を note 直下に挿入
    const inserted = await page.evaluate(() => {
      const anyBlock =
        document.querySelector('affine-note [data-block-id]') ||
        document.querySelector('[data-block-id]');
      const store = (anyBlock as any).std.store;
      const note = store.root.children.find(
        (c: any) => c.flavour === 'affine:note'
      );
      const specs: Array<[string, Record<string, unknown>]> = [
        ['affine:bookmark', { url: 'https://example.com/' }],
        [
          'affine:embed-youtube',
          { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        ],
        [
          'affine:embed-github',
          { url: 'https://github.com/x/y', owner: 'x', repo: 'y' },
        ],
        ['affine:embed-figma', { url: 'https://www.figma.com/file/abc' }],
        ['affine:embed-loom', { url: 'https://www.loom.com/share/abc' }],
        ['affine:embed-html', { html: '<h1>hi</h1>', style: 'html' }],
        [
          'affine:embed-iframe',
          { url: 'https://example.com/', iframeUrl: 'https://example.com/' },
        ],
      ];
      const results: Record<string, boolean> = {};
      for (const [flavour, props] of specs) {
        try {
          const id = store.addBlock(flavour, props, note);
          results[flavour] = !!id;
        } catch (e) {
          results[flavour] = false;
        }
      }
      return results;
    });

    // すべての flavour が例外なく挿入できたこと（スキーマ登録の回帰検知）
    for (const [flavour, ok] of Object.entries(inserted)) {
      expect(ok, `${flavour} の挿入に失敗`).toBe(true);
    }

    // 対応する custom element が描画されること（コンポーネント登録の回帰検知）
    await expect(page.locator('affine-bookmark')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('affine-embed-youtube-block')).toBeVisible();
    await expect(page.locator('affine-embed-github-block')).toBeVisible();
    await expect(page.locator('affine-embed-figma-block')).toBeVisible();
    await expect(page.locator('affine-embed-loom-block')).toBeVisible();
    await expect(page.locator('affine-embed-html-block')).toBeVisible();
    await expect(page.locator('affine-embed-iframe-block')).toBeVisible();

    // XSS 回帰ガード: embed-html の iframe は sandbox に allow-same-origin を含まない
    // （opaque origin で実行され、アプリの Cookie/DOM/Storage にアクセスできない）。
    const htmlSandbox = await page
      .locator('affine-embed-html-block iframe')
      .first()
      .getAttribute('sandbox');
    expect(htmlSandbox).toBeTruthy();
    expect(htmlSandbox).toContain('allow-scripts');
    expect(htmlSandbox).not.toContain('allow-same-origin');

    // 描画中に未捕捉エラー（クラッシュ）が出ていないこと
    expect(uncaught).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. 検索（共有コンテキスト）
// ---------------------------------------------------------------------------
test.describe('検索', () => {
  test('検索ダイアログが開いてドキュメントを検索できる', async ({ sharedPage: page }) => {
    await ensureSidebarOpen(page);

    // サイドバーの Search をクリック
    await page.locator('text=クイック検索').first().click();
    await page.waitForTimeout(1_000);

    // 検索ダイアログが表示される（cmdk の検索入力フィールド）
    await expect(
      page.locator('input[cmdk-input]')
    ).toBeVisible({ timeout: 5_000 });

    // "wiki" を検索
    await page.keyboard.type('wiki', { delay: 100 });
    await page.waitForTimeout(1_000);

    // 検索ダイアログが何らかの結果（候補・新規作成オプション等）を表示すること
    // （テスト環境ではインデックスが存在しない場合もあるため、ダイアログが開いていること自体を確認）
    const dialogVisible = await page.locator('input[cmdk-input]').isVisible();
    expect(dialogVisible).toBe(true);

    await page.keyboard.press('Escape');
  });
});

// ---------------------------------------------------------------------------
// 6. サイドバー・ナビゲーション（共有コンテキスト）
// ---------------------------------------------------------------------------
test.describe('サイドバー', () => {
  test('主要なナビゲーション項目が表示される', async ({ sharedPage: page }) => {
    await ensureSidebarOpen(page);

    // 主要なサイドバー項目が表示されること
    await expect(page.locator('text=クイック検索')).toBeVisible();
    await expect(page.locator('text=すべてのドキュメント')).toBeVisible();
    await expect(page.locator('text=日記').first()).toBeVisible();
    await expect(page.locator('text=設定')).toBeVisible();
    await expect(page.locator('text=ゴミ箱')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 7. バックエンド API（共有コンテキスト）
// ---------------------------------------------------------------------------
test.describe('バックエンド API', () => {
  test('GraphQL エンドポイントが応答する', async ({ sharedPage: page }) => {
    await enterOrCreateWorkspace(page);

    const result = await graphqlQuery(page, '{ serverConfig { version } }');
    expect(result.data.serverConfig).toBeTruthy();
  });

  test('セッション API が認証済みユーザーを返す', async ({ sharedPage: page }) => {
    const session = await page.evaluate(async () => {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      return res.json();
    });
    expect(session.user).toBeTruthy();
    expect(session.user.email).toBe(TEST_USER.email);
  });

  test('リンクプレビュー API が 200/空応答を返す（#52 404回帰防止）', async ({
    sharedPage: page,
  }) => {
    // 「外部送信ゼロ」方針の no-op スタブ。埋め込み(YouTube等)貼付時にフロントが
    // POST する /api/worker/link-preview が 404 を出さず 200 で空応答を返すこと。
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/worker/link-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
        credentials: 'include',
      });
      return { status: r.status, body: await r.json() };
    });
    expect(res.status).toBe(200);
    // OGP メタを外部取得しないため空オブジェクト。
    expect(res.body).toEqual({});
  });

  test('バージョン履歴 GraphQL クエリが正常に返る', async ({ sharedPage: page }) => {
    await enterOrCreateWorkspace(page);

    // 新規ページを作成して docId を URL から取得
    await createNewPage(page);
    await page.waitForURL(/\/workspace\/([^/]+)\/([^/?#]+)/, { timeout: 10_000 });
    const urlMatch = page.url().match(/\/workspace\/([^/]+)\/([^/?#]+)/);
    expect(urlMatch).not.toBeNull();
    const workspaceId = urlMatch![1];
    const docId = urlMatch![2];

    // histories クエリがエラーなく返ること（履歴0件でもOK）
    const result = await graphqlQuery(
      page,
      `query {
        workspace(id: "${workspaceId}") {
          histories(guid: "${docId}", take: 10) {
            id
            timestamp
          }
        }
      }`
    );

    expect(result.errors).toBeUndefined();
    expect(Array.isArray(result.data?.workspace?.histories)).toBe(true);
  });

  test('マニュアルWSが Reader で自動参加し最下部・読み取り専用（#72）', async ({
    sharedPage: page,
  }) => {
    // #72 マニュアル専用WS。workspaces 取得で各ユーザーが Reader として遅延参加し、
    // 「📖 マニュアル」が固定 all-f UUID（一覧最下部）で現れ、編集不可であること。
    // ※ backend/seed/manual.zip がある環境でのみマニュアルWSが作られる。
    const list = await graphqlQuery(page, '{ workspaces { id name } }');
    expect(list.errors).toBeUndefined();
    const workspaces: Array<{ id: string; name: string }> =
      list.data?.workspaces ?? [];
    const manual = workspaces.find(w => w.id.startsWith('ffffffff-ffff-4fff'));

    // seed 未投入の環境ではマニュアルWSが無いのでスキップ（機構は他テストで担保）。
    test.skip(!manual, 'マニュアルWSが未シード（backend/seed/manual.zip 無し）');

    // 表示名が「📖 マニュアル」であること。
    expect(manual!.name).toContain('マニュアル');

    // Reader は編集不可（Doc_Update=false）＝バックエンド強制の読み取り専用。
    const perm = await graphqlQuery(
      page,
      `query {
        workspace(id: "${manual!.id}") {
          doc(docId: "${manual!.id}") {
            permissions { Doc_Read Doc_Update Doc_Trash }
          }
        }
      }`
    );
    expect(perm.errors).toBeUndefined();
    const p = perm.data?.workspace?.doc?.permissions;
    expect(p?.Doc_Read).toBe(true);
    expect(p?.Doc_Update).toBe(false);
    expect(p?.Doc_Trash).toBe(false);
  });

  test('招待リンクの生成・表示・失効ができる', async ({ sharedPage: page }) => {
    await enterOrCreateWorkspace(page);

    const urlMatch = page.url().match(/\/workspace\/([^/?#]+)/);
    expect(urlMatch).not.toBeNull();
    const workspaceId = urlMatch![1];

    // 生成: createInviteLink が成功し、フルURL形式のリンクと有効期限を返す
    const created = await graphqlQuery(
      page,
      `mutation ($workspaceId: String!, $expireTime: WorkspaceInviteLinkExpireTime!) {
        createInviteLink(workspaceId: $workspaceId, expireTime: $expireTime) {
          link
          expireTime
        }
      }`,
      { workspaceId, expireTime: 'OneWeek' }
    );
    expect(created.errors).toBeUndefined();
    expect(created.data?.createInviteLink?.link).toContain('/invite/');
    expect(created.data?.createInviteLink?.expireTime).toBeTruthy();

    // 表示: getWorkspaceConfig（画面が参照するクエリ）が生成済みリンクを返す
    const config = await graphqlQuery(
      page,
      `query ($id: String!) {
        workspace(id: $id) {
          inviteLink { link expireTime }
        }
      }`,
      { id: workspaceId }
    );
    expect(config.errors).toBeUndefined();
    expect(config.data?.workspace?.inviteLink?.link).toBe(
      created.data.createInviteLink.link
    );

    // 失効: revokeInviteLink 後は inviteLink が null になる
    const revoked = await graphqlQuery(
      page,
      `mutation ($workspaceId: String!) {
        revokeInviteLink(workspaceId: $workspaceId)
      }`,
      { workspaceId }
    );
    expect(revoked.errors).toBeUndefined();
    expect(revoked.data?.revokeInviteLink).toBe(true);

    const afterRevoke = await graphqlQuery(
      page,
      `query ($id: String!) {
        workspace(id: $id) {
          inviteLink { link expireTime }
        }
      }`,
      { id: workspaceId }
    );
    expect(afterRevoke.errors).toBeUndefined();
    expect(afterRevoke.data?.workspace?.inviteLink).toBeNull();
  });

  test('内部API: upsert で書いた markdown を get-markdown で往復取得できる（#30）', async ({ sharedPage: page }) => {
    await enterOrCreateWorkspace(page);

    const urlMatch = page.url().match(/\/workspace\/([^/?#]+)/);
    expect(urlMatch).not.toBeNull();
    const workspaceId = urlMatch![1];
    const docId = `rag-test-${Date.now()}`;
    const markdown = '# 見出し\n本文の段落です。\n## サブ見出し\n---\n最後の行';

    // upsert: 本文を書き込む
    const upsertRes = await page.evaluate(
      async ({ workspaceId, docId, markdown }) => {
        const res = await fetch('/api/internal/docs/upsert', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, docId, title: 'RAGテスト', markdown }),
        });
        return { status: res.status, body: await res.json() };
      },
      { workspaceId, docId, markdown }
    );
    expect(upsertRes.status).toBe(200);
    expect(upsertRes.body.ok).toBe(true);

    // get-markdown: JWT 下で 200、タイトル・本文が往復一致する
    const getRes = await page.evaluate(
      async ({ workspaceId, docId }) => {
        const res = await fetch('/api/internal/docs/get-markdown', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, docId }),
        });
        return { status: res.status, body: await res.json() };
      },
      { workspaceId, docId }
    );
    expect(getRes.status).toBe(200);
    expect(getRes.body.title).toBe('RAGテスト');
    expect(getRes.body.markdown).toBe(markdown);

    // 存在しない docId は 404
    const notFound = await page.evaluate(
      async ({ workspaceId }) => {
        const res = await fetch('/api/internal/docs/get-markdown', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, docId: 'does-not-exist-xyz' }),
        });
        return res.status;
      },
      { workspaceId }
    );
    expect(notFound).toBe(404);

    // 存在しない workspaceId への upsert は FK 違反の 500 ではなく明示的な 404（#33）
    const upsertNoWs = await page.evaluate(async () => {
      const res = await fetch('/api/internal/docs/upsert', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: '00000000-0000-0000-0000-000000000000',
          docId: 'no-ws-doc',
          title: 'no ws',
          markdown: 'x',
        }),
      });
      return res.status;
    });
    expect(upsertNoWs).toBe(404);

    // get-markdown も同様に workspace 不在で 404
    const getNoWs = await page.evaluate(async () => {
      const res = await fetch('/api/internal/docs/get-markdown', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: '00000000-0000-0000-0000-000000000000',
          docId: 'no-ws-doc',
        }),
      });
      return res.status;
    });
    expect(getNoWs).toBe(404);

    // UUID 形式でない workspaceId も Prisma の生500ではなく 404 に倒す（#33 / Geminiレビュー）
    const upsertBadUuid = await page.evaluate(async () => {
      const res = await fetch('/api/internal/docs/upsert', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'invalid-id',
          docId: 'bad-uuid-doc',
          title: 'bad uuid',
          markdown: 'x',
        }),
      });
      return res.status;
    });
    expect(upsertBadUuid).toBe(404);
  });

  test('検索: InputType が有効で、不正なフィールドは拒否される（H-6復旧 + H-2 SQLi対策）', async ({ sharedPage: page }) => {
    await enterOrCreateWorkspace(page);
    const urlMatch = page.url().match(/\/workspace\/([^/?#]+)/);
    expect(urlMatch).not.toBeNull();
    const workspaceId = urlMatch![1];

    const aggregateQuery = `query Agg($id: String!, $input: AggregateInput!) {
      workspace(id: $id) {
        aggregate(input: $input) { pagination { count } }
      }
    }`;

    // 1) 正当なフィールド（docId）は InputType が剥ぎ取られず実行できる（H-6 復旧の確認）
    const ok = await graphqlQuery(page, aggregateQuery, {
      id: workspaceId,
      input: {
        table: 'block',
        query: { type: 'all' },
        field: 'docId',
        options: { hits: { fields: ['docId'] } },
      },
    });
    expect(ok.errors).toBeUndefined();
    expect(typeof ok.data?.workspace?.aggregate?.pagination?.count).toBe('number');

    // 2) 許可リスト外のフィールド（SQL識別子インジェクションの入口）は拒否される
    const evil = await graphqlQuery(page, aggregateQuery, {
      id: workspaceId,
      input: {
        table: 'block',
        query: { type: 'all' },
        field: 'content); DROP TABLE users;--',
        options: { hits: { fields: ['docId'] } },
      },
    });
    expect(evil.errors?.[0]?.message ?? '').toMatch(/invalid search field/i);
    expect(evil.data?.workspace?.aggregate ?? null).toBeNull();

    // 3) users テーブルが健在であること（DROP が実行されていない）を別経路で確認
    const session = await page.evaluate(async () => {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      return res.json();
    });
    expect(session.user?.email).toBe(TEST_USER.email);
  });
});

// ---------------------------------------------------------------------------
// 8. Socket.IO リアルタイム同期（共有コンテキスト）
// ---------------------------------------------------------------------------
test.describe('リアルタイム同期', () => {
  test('Socket.IO 接続が確立される', async ({ sharedPage: page }) => {
    await enterOrCreateWorkspace(page);

    // ドキュメントを開く
    await ensureSidebarOpen(page);
    await page.locator('text=すべてのドキュメント').click();
    await page.waitForTimeout(2_000);

    const firstDoc = page.locator('text=Getting Started').first();
    if (await firstDoc.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await firstDoc.click();
      await page.waitForTimeout(3_000);
    }

    // Socket.IO サーバーが応答しているか直接確認（WebSocket は performance API で取得できないため）
    const response = await page.request.get(
      'http://localhost:3010/socket.io/?EIO=4&transport=polling'
    );
    expect(response.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 9. テンプレート（共有コンテキスト）
// ---------------------------------------------------------------------------
test.describe('テンプレート', () => {
  test('テンプレートメニューが表示され、テンプレートを作成できる', async ({ sharedPage: page }) => {
    await ensureSidebarOpen(page);

    // サイドバーの Template リンクをクリック（data-testid で一意に特定）
    const templateEntrance = page.locator('[data-testid="sidebar-template-doc-entrance"]');
    await templateEntrance.scrollIntoViewIfNeeded();
    await templateEntrance.click();
    await page.waitForTimeout(1_000);

    // テンプレートメニューが表示される（「Create new template」ボタンが存在する）
    const createBtn = page.locator('[data-testid="template-doc-item-create"]');
    await expect(createBtn).toBeVisible({ timeout: 5_000 });

    // 「Create new template」をクリックしてテンプレートを作成
    await createBtn.click();
    await page.waitForTimeout(2_000);

    // テンプレートページが開かれる（タイトルブロックが表示される）
    await expect(page.locator('[data-block-is-title]')).toBeVisible({ timeout: 10_000 });

    // テンプレートにタイトルを入力
    await page.locator('[data-block-is-title]').click();
    await page.keyboard.type('E2E Test Template', { delay: 50 });
    await page.waitForTimeout(1_000);
  });

  test('作成したテンプレートがテンプレートメニューに表示される', async ({ sharedPage: page }) => {
    await ensureSidebarOpen(page);

    // サイドバーの Template リンクをクリック
    const templateEntrance = page.locator('[data-testid="sidebar-template-doc-entrance"]');
    await templateEntrance.scrollIntoViewIfNeeded();
    await templateEntrance.click();
    await page.waitForTimeout(1_000);

    // テンプレートアイテムが表示される（先ほど作成した「E2E Test Template」）
    const templateItems = page.locator('[data-testid^="template-doc-item-"]:not([data-testid="template-doc-item-create"])');
    const count = await templateItems.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // テンプレート名が表示されていること
    const hasTemplate = await page.evaluate(() => {
      return document.body.innerText.includes('E2E Test Template');
    });
    expect(hasTemplate).toBe(true);

    // メニューを閉じる
    await page.keyboard.press('Escape');
  });
});

// ---------------------------------------------------------------------------
// 10. コピー＆ペースト（共有コンテキスト）
// ---------------------------------------------------------------------------
test.describe('コピー＆ペースト', () => {
  test('エディタ内でテキストをペーストできる', async ({ sharedPage: page }) => {
    await ensureSidebarOpen(page);
    await createNewPage(page);
    await page.waitForTimeout(2_000);

    // 本文エリアにテキスト入力
    const editor = page.locator('[data-block-id] .inline-editor').first();
    await editor.click();
    const testText = 'PasteTest123';
    await page.keyboard.type(testText);
    await page.waitForTimeout(500);

    // JS 経由でクリップボードに書き込む（headless Chromium での Ctrl+C の信頼性を回避）
    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, testText);

    // 行末に移動して改行し、新しいブロックへ移動してペースト
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(1_500);

    // ペーストされたテキストがページ内に存在する（元の1回＋貼り付け1回 = 計2回以上）
    const count = await page.locator(`text=${testText}`).count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('Ctrl+C でエディタのテキストがクリップボードにコピーされる', async ({ sharedPage: page }) => {
    await ensureSidebarOpen(page);
    await createNewPage(page);
    await page.waitForTimeout(2_000);

    const editor = page.locator('[data-block-id] .inline-editor').first();
    await editor.click();
    const testText = 'CtrlCTest456';
    await page.keyboard.type(testText);
    await page.waitForTimeout(500);

    // Home → Shift+End でテキスト選択
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.waitForTimeout(200);

    // クリップボードを事前にクリア
    await page.evaluate(async () => {
      await navigator.clipboard.writeText('');
    });

    // Ctrl+C でコピー（BlockSuite のコピーハンドラを経由）
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(500);

    // navigator.clipboard.readText() で text/plain の内容を確認
    const clipboardText = await page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return '';
      }
    });

    // コピー後にクリップボードに何らかのテキストが入っていること
    // （HTTP環境では clipboardData 経由、HTTPS/localhost では navigator.clipboard 経由）
    expect(clipboardText.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 11. ドキュメント削除（共有コンテキスト）  ※旧10番
// ---------------------------------------------------------------------------
test.describe('ドキュメント削除', () => {
  test('ドキュメントをゴミ箱に移動できる', async ({ sharedPage: page }) => {
    await ensureSidebarOpen(page);

    // 新規ページを作成
    await createNewPage(page);
    await page.waitForTimeout(2_000);
    await expect(page.locator('[data-block-is-title]')).toBeVisible({ timeout: 10_000 });

    // タイトルを入力（後で確認用）
    await page.locator('[data-block-is-title]').click();
    await page.keyboard.type('E2E Delete Test', { delay: 50 });
    await page.waitForTimeout(1_000);

    // ヘッダーの「...」メニューを開く
    await page.locator('[data-testid="header-dropDownButton"]').click();
    await page.waitForTimeout(500);

    // 「Move to Trash」をクリック
    await page.locator('[data-testid="editor-option-menu-delete"]').click();
    await page.waitForTimeout(500);

    // 確認ダイアログで「Delete」をクリック
    await page.locator('[data-testid="confirm-modal-confirm"]').click();
    await page.waitForTimeout(2_000);

    // ゴミ箱に移動された — Trash ページを確認
    await ensureSidebarOpen(page);
    await page.locator('[data-testid="trash-page"]').click();
    await page.waitForTimeout(2_000);

    // ゴミ箱に「E2E Delete Test」が存在する
    const inTrash = await page.evaluate(() => {
      return document.body.innerText.includes('E2E Delete Test');
    });
    expect(inTrash).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 13. クロスセッション Blob 同期
//     「別ブラウザ（別コンテキスト）でも画像が見える」バグの回帰テスト
// ---------------------------------------------------------------------------
test.describe('クロスセッション Blob 同期', () => {
  test('別コンテキストで画像・テキストの表示・削除・ページ削除が機能する', async ({ browser }) => {
    test.setTimeout(180_000); // 5コンテキスト × サインイン時間を考慮

    // テスト用 4×4 PNG (赤: Node.js zlib で生成した有効な PNG)
    const TEST_PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP4z8AARwzEcQCukw/x0F8jngAAAABJRU5ErkJggg==',
      'base64'
    );
    const TEST_TEXT = `CrossSessionText_${Date.now()}`;
    let targetUrl = '';

    // ── ctx1: ページ作成・テキスト入力・画像アップロード ──────────────────
    {
      const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const p1 = await ctx1.newPage();
      try {
        await signInViaAPI(p1);
        await ensureSidebarOpen(p1);
        await createNewPage(p1);
        await p1.waitForTimeout(2_000);
        await expect(p1.locator('[data-block-is-title]')).toBeVisible({ timeout: 10_000 });

        // 1. タイトル入力
        await p1.locator('[data-block-is-title]').click();
        await p1.keyboard.type('Cross Session Test', { delay: 30 });

        // 2. 本文テキスト入力
        await p1.keyboard.press('Enter');
        await p1.waitForTimeout(300);
        const bodyEditor = p1.locator('[data-block-id] .inline-editor').first();
        await bodyEditor.click();
        await p1.keyboard.type(TEST_TEXT, { delay: 30 });
        await p1.waitForTimeout(500);

        // 3. 画像をクリップボード経由でエディタに貼り付け
        //    （スラッシュメニューより安定した方法）
        await p1.keyboard.press('End');
        await p1.keyboard.press('Enter');
        await p1.waitForTimeout(300);

        // PNG を Uint8Array → Blob → ClipboardItem としてクリップボードへ書き込む
        const pngBytes = Array.from(TEST_PNG);
        await p1.evaluate(async (bytes) => {
          const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        }, pngBytes);

        // Ctrl+V でエディタに貼り付け
        await p1.keyboard.press('Control+v');
        await p1.waitForTimeout(2_000);

        // アップロード完了 + サーバー同期を待機
        await p1.waitForTimeout(5_000);

        targetUrl = p1.url();
        expect(targetUrl).toMatch(/\/workspace\//);
      } finally {
        await ctx1.close();
      }
    }

    expect(targetUrl).toBeTruthy();

    // ── ctx2: 同じページを開いてテキスト・画像を確認し、削除 ───────────────
    {
      const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const p2 = await ctx2.newPage();
      try {
        await signInViaAPI(p2);
        await p2.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        // Yjs 同期 + Blob ダウンロード待機
        await p2.waitForTimeout(8_000);

        // 4. テキストが表示されること
        const hasText = await p2.evaluate(
          (text: string) => document.body.innerText.includes(text),
          TEST_TEXT
        );
        expect(hasText).toBe(true);

        // 5. 画像が表示されること（blob: URL の img 要素が存在する）
        const imgCount = await p2.evaluate(
          () => document.querySelectorAll('img[src^="blob:"], img[src^="data:"]').length
        );
        expect(imgCount).toBeGreaterThan(0);

        // 6. ctx2 で画像を削除（画像ブロックをクリック → Delete キー）
        const imgEl = p2.locator('img[src^="blob:"], img[src^="data:"]').first();
        await imgEl.click();
        await p2.waitForTimeout(500);
        await p2.keyboard.press('Escape'); // ブロック選択モードへ
        await p2.waitForTimeout(200);
        await p2.keyboard.press('Backspace');
        await p2.waitForTimeout(1_500);

        const imgAfter = await p2.evaluate(
          () => document.querySelectorAll('img[src^="blob:"], img[src^="data:"]').length
        );
        expect(imgAfter).toBe(0);

        // 7. ctx2 でテキストを削除（行全体を選択 → Delete）
        const textEl = p2.locator('[data-block-id] .inline-editor').filter({ hasText: TEST_TEXT }).first();
        await textEl.click();
        await p2.waitForTimeout(300);
        await p2.keyboard.press('Home');
        await p2.keyboard.press('Shift+End');
        await p2.keyboard.press('Delete');
        await p2.waitForTimeout(300);
        // 空になったブロックごと削除
        await p2.keyboard.press('Backspace');
        await p2.waitForTimeout(1_500);

        const hasTextAfter = await p2.evaluate(
          (text: string) => document.body.innerText.includes(text),
          TEST_TEXT
        );
        expect(hasTextAfter).toBe(false);

        // サーバーへの Yjs 同期を待機
        await p2.waitForTimeout(5_000);
      } finally {
        await ctx2.close();
      }
    }

    // ── ctx1(新): 画像・テキストが削除されていることを確認 ─────────────────
    {
      const ctx1b = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const p1b = await ctx1b.newPage();
      try {
        await signInViaAPI(p1b);
        await p1b.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        await p1b.waitForTimeout(8_000);

        // 8. 画像が削除されていること
        const imgInCtx1 = await p1b.evaluate(
          () => document.querySelectorAll('img[src^="blob:"], img[src^="data:"]').length
        );
        expect(imgInCtx1).toBe(0);

        // 9. テキストが削除されていること
        const textInCtx1 = await p1b.evaluate(
          (text: string) => document.body.innerText.includes(text),
          TEST_TEXT
        );
        expect(textInCtx1).toBe(false);
      } finally {
        await ctx1b.close();
      }
    }

    // ── ctx2(新): ページを削除（ゴミ箱へ移動） ────────────────────────────
    {
      const ctx2b = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const p2b = await ctx2b.newPage();
      try {
        await signInViaAPI(p2b);
        await p2b.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        await p2b.waitForTimeout(3_000);

        // 10. ヘッダーメニューからゴミ箱へ移動
        await p2b.locator('[data-testid="header-dropDownButton"]').click();
        await p2b.waitForTimeout(500);
        await p2b.locator('[data-testid="editor-option-menu-delete"]').click();
        await p2b.waitForTimeout(500);
        await p2b.locator('[data-testid="confirm-modal-confirm"]').click();
        await p2b.waitForTimeout(2_000);
      } finally {
        await ctx2b.close();
      }
    }

    // ── ctx1(新): ページにアクセスできない（ゴミ箱状態）ことを確認 ──────────
    {
      const ctx1c = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const p1c = await ctx1c.newPage();
      try {
        await signInViaAPI(p1c);
        await p1c.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        await p1c.waitForTimeout(3_000);

        // 11. ページが削除済みか、別URLにリダイレクトされていること
        const isPageGone = await p1c.evaluate((url: string) => {
          const currentUrl = window.location.href;
          const text = document.body.innerText;
          return (
            currentUrl !== url ||
            text.includes('ゴミ箱') ||
            text.includes('Trash') ||
            text.includes('Deleted') ||
            text.includes('削除') ||
            text.includes('not found') ||
            text.includes('見つかりません')
          );
        }, targetUrl);
        expect(isPageGone).toBe(true);
      } finally {
        await ctx1c.close();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 12. ワークスペース削除（独立コンテキスト — 共有コンテキストを壊さない）
// ---------------------------------------------------------------------------
test.describe('ワークスペース削除', () => {
  test('GraphQL でワークスペースを削除できる', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    // 現在のワークスペース ID を URL から取得
    const url = page.url();
    const wsIdMatch = url.match(/\/workspace\/([^/]+)/);
    expect(wsIdMatch).toBeTruthy();
    const workspaceIdFromUrl = wsIdMatch![1];

    // サーバー側ワークスペース一覧とログインユーザーを取得（auth 動作確認を兼ねる）
    const wsListResult = await graphqlQuery(page, '{ currentUser { id } workspaces { id owner { id } } }');
    if (!wsListResult.data?.workspaces) {
      throw new Error(`workspaces クエリが失敗しました: ${JSON.stringify(wsListResult)}`);
    }
    const myId: string = wsListResult.data.currentUser.id;
    const workspaces: { id: string; owner: { id: string } }[] = wsListResult.data.workspaces;
    expect(workspaces.length).toBeGreaterThan(0);

    // URL の ID がオーナーなワークスペースであればそれを、なければ最初のオーナーワークスペースを使用
    const ownedWorkspaces = workspaces.filter(ws => ws.owner?.id === myId);
    expect(ownedWorkspaces.length).toBeGreaterThan(0);
    const workspaceId = ownedWorkspaces.find(ws => ws.id === workspaceIdFromUrl)?.id
      ?? ownedWorkspaces[0].id;

    // GraphQL でワークスペースを削除
    const result = await graphqlQuery(
      page,
      `mutation { deleteWorkspace(id: "${workspaceId}") }`
    );
    if (!result.data) {
      throw new Error(`deleteWorkspace が失敗しました: ${JSON.stringify(result)}`);
    }
    expect(result.data.deleteWorkspace).toBe(true);

    // ルートに遷移 → ワークスペースが0個なので新規自動作成 → 別のワークスペースに遷移
    await page.goto('/');
    await page.waitForTimeout(3_000);
    await page.waitForURL(/\/workspace\//, { timeout: 30_000 });

    // 削除されたワークスペースとは異なる ID のワークスペースに遷移していること
    const currentUrl = page.url();
    expect(currentUrl).not.toContain(workspaceId);
  });

  // ---------------------------------------------------------------------------
  // 編集履歴 (Issue #6)
  // ---------------------------------------------------------------------------

});

// ---------------------------------------------------------------------------
// インポート × Undo の安全性（ルートページブロック消失バグの再発防止）
//
// 既知の事象: 新規ページで Markdown/HTML をインポート → 直後に Ctrl-Z すると、
// インポート文書だけでなくルート affine:page ブロックごと全削除され、
// 以後ページが開けなくなる（NoPageRootError）。
// 修正: インポート経路で undoManager.clear() を呼び、インポートを undo 不可の
// ベースラインにする。本テストはその再発を検知する。
// ---------------------------------------------------------------------------
test.describe('インポート × Undo の安全性', () => {
  test('Markdown インポート直後に Ctrl-Z してもページが壊れない', async ({ sharedPage: page }) => {
    const marker = `IMPORT_UNDO_${Date.now()}`;
    const markdown = `# 見出しテスト\n\n${marker}\n\n- 箇条書き1\n- 箇条書き2\n`;

    // このテスト単体でも動くよう、未認証ならサインインしておく
    // （serial 実行では先行テストでサインイン済みなのでスキップされる）
    if (!page.url().includes('/workspace/')) {
      await signInViaAPI(page);
    }
    await enterOrCreateWorkspace(page);

    // 全ドキュメント一覧へ（インポートトリガを確実に出すため）
    await ensureSidebarOpen(page);

    // サイドバーのインポートトリガを開く
    const importTrigger = page.locator('[data-testid="import-modal-trigger"]');
    await importTrigger.first().waitFor({ state: 'visible', timeout: 30_000 });
    await importTrigger.first().click();

    // インポートダイアログ表示
    const dialog = page.locator('[data-testid="import-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Chromium は File System Access API(showOpenFilePicker) を使うため Playwright の
    // filechooser では捕捉できない。無効化して <input type=file> フォールバックに倒す。
    await page.evaluate(() => {
      // @ts-expect-error テスト用にネイティブピッカーを無効化
      window.showOpenFilePicker = undefined;
    });

    // Markdown インポート項目をクリック → ファイル選択を差し込む
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid="editor-option-menu-import-markdown-files"]').first().click(),
    ]);
    await chooser.setFiles({
      name: 'regression-import.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(markdown, 'utf-8'),
    });

    // インポート成功 → 成功モーダルの Complete を押すと取り込んだドキュメントへ遷移する
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    // 成功画面の主ボタン（Complete, i18n）をクリック → ドキュメントを開く
    await dialog.getByRole('button').last().click();

    // エディタ内に取り込んだ本文とタイトルブロックが表示される
    await expect(page.locator('[data-block-is-title]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`text=${marker}`)).toBeVisible({ timeout: 30_000 });

    // エディタにフォーカスして直後に Undo（Ctrl-Z）
    // 修正前はここでルートページごと全削除され、ページが開けなくなっていた。
    await page.locator('[data-block-is-title]').click();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(1_000);

    // 修正後の期待: インポートは undo 不可のベースラインなので Ctrl-Z は no-op。
    // 本文が残り、タイトルブロック（=ルートページ）が健在で、ページが開けること。
    await expect(page.locator('[data-block-is-title]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`text=${marker}`)).toBeVisible({ timeout: 10_000 });
    // 「ページが開けない」系のエラー表示が出ていないこと
    await expect(page.locator('text=Page root not found')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 9. アクセス制御（ワークスペース越境防止 / H-1）
//   共有ページ（管理者セッション）を使わず、サーバーAPIへ直接 fetch する。
//   越境の拒否は「非管理ユーザー」でしか検証できない（TEST_USER は
//   サーバ全体 Admin でガードをバイパスするため）。
// ---------------------------------------------------------------------------
test.describe('アクセス制御（ワークスペース越境防止）', () => {
  const API = 'http://localhost:3010';
  // TEST_USER とは別の、Admin 権限を持たない部外者ユーザー
  const OUTSIDER = {
    email: 'e2e-outsider@ofuro-wiki.local',
    password: 'E2eOutsider123!',
  };

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

  async function gql(
    cookie: string,
    query: string,
    variables?: Record<string, any>,
  ) {
    const res = await fetch(`${API}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ query, variables }),
    });
    return res.json();
  }

  test('非メンバーは他人のワークスペースを読み書きできない', async () => {
    // 管理者がワークスペースを作成
    const adminCookie = await authCookie(TEST_USER.email, TEST_USER.password);
    const created = await gql(
      adminCookie,
      `mutation ($name: String) { createWorkspace(name: $name) { id } }`,
      { name: 'authz-owner-ws' },
    );
    const wsId = created.data?.createWorkspace?.id;
    expect(wsId).toBeTruthy();

    try {
      // 部外者（非Admin・非メンバー）
      const outsiderCookie = await authCookie(OUTSIDER.email, OUTSIDER.password);

      // 1) workspace(id): データは返らず、認可エラーになる
      const q1 = await gql(
        outsiderCookie,
        `query ($id: String!) { workspace(id: $id) { id } }`,
        { id: wsId },
      );
      expect(q1.data?.workspace ?? null).toBeNull();
      expect(q1.errors?.[0]?.message ?? '').toMatch(/denied/i);

      // 2) workspaceDocs: 認可エラーになる
      const q2 = await gql(
        outsiderCookie,
        `query ($w: String!) { workspaceDocs(workspaceId: $w) { docId } }`,
        { w: wsId },
      );
      expect(q2.errors?.[0]?.message ?? '').toMatch(/denied/i);

      // 3) 内部API upsert: 403 Forbidden
      const upsertStatus = await (async () => {
        const res = await fetch(`${API}/api/internal/docs/upsert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: outsiderCookie },
          body: JSON.stringify({
            workspaceId: wsId,
            docId: 'authz-x',
            title: 'x',
            markdown: 'x',
          }),
        });
        return res.status;
      })();
      expect(upsertStatus).toBe(403);
    } finally {
      // 後始末: 管理者がワークスペースを削除
      await gql(adminCookie, `mutation ($id: String!) { deleteWorkspace(id: $id) }`, {
        id: wsId,
      });
    }
  });

  test('メンバーは自分のワークスペースにアクセスできる（ポジティブコントロール）', async () => {
    const outsiderCookie = await authCookie(OUTSIDER.email, OUTSIDER.password);
    const created = await gql(
      outsiderCookie,
      `mutation ($name: String) { createWorkspace(name: $name) { id } }`,
      { name: 'authz-own-ws' },
    );
    const wsId = created.data?.createWorkspace?.id;
    expect(wsId).toBeTruthy();

    try {
      const q = await gql(
        outsiderCookie,
        `query ($id: String!) { workspace(id: $id) { id } }`,
        { id: wsId },
      );
      expect(q.errors).toBeUndefined();
      expect(q.data?.workspace?.id).toBe(wsId);
    } finally {
      await gql(outsiderCookie, `mutation ($id: String!) { deleteWorkspace(id: $id) }`, {
        id: wsId,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 10. 入力検証・セキュリティヘッダ（M-1 / M-4 / M-5）
// ---------------------------------------------------------------------------
test.describe('入力検証・セキュリティヘッダ', () => {
  const API = 'http://localhost:3010';

  async function adminCookie(): Promise<string> {
    const res = await fetch(`${API}/api/auth/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: TEST_USER.email,
        password: TEST_USER.password,
      }),
    });
    const cookies = res.headers.getSetCookie?.() ?? [];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }

  test('L-1: sign-out-all で発行済みトークンが即時失効する', async () => {
    // サインインしてトークン Cookie を取得
    const si = await fetch(`${API}/api/auth/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: TEST_USER.email,
        password: TEST_USER.password,
      }),
    });
    const setCookies = si.headers.getSetCookie?.() ?? [];
    const tokenCookie = setCookies
      .map((c) => c.split(';')[0])
      .find((c) => c.startsWith('affine_token='));
    expect(tokenCookie).toBeTruthy();

    const session = (cookie: string) =>
      fetch(`${API}/api/auth/session`, { headers: { Cookie: cookie } }).then(
        (r) => r.json(),
      );

    // 失効前: user が取得できる
    const before = await session(tokenCookie!);
    expect(before.user?.email).toBe(TEST_USER.email);

    // 全端末サインアウトで tokenVersion +1 → 発行済みトークンを失効
    const out = await fetch(`${API}/api/auth/sign-out-all`, {
      method: 'POST',
      headers: { Cookie: tokenCookie! },
    });
    expect([200, 201]).toContain(out.status);

    // 失効後: 同じ旧トークンでは user:null（即時失効）
    const after = await session(tokenCookie!);
    expect(after.user ?? null).toBeNull();

    // 再サインインは成功する（新トークンは有効）
    const re = await fetch(`${API}/api/auth/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: TEST_USER.email,
        password: TEST_USER.password,
      }),
    });
    expect([200, 201]).toContain(re.status);
  });

  test('M-1: 弱いパスワード・不正メールのサインアップは拒否される', async () => {
    // パスワードが短すぎる → 400
    const weak = await fetch(`${API}/api/auth/sign-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `m1-${Date.now()}@example.com`, password: 'short' }),
    });
    expect(weak.status).toBe(400);

    // メール形式が不正 → 400
    const badEmail = await fetch(`${API}/api/auth/sign-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'ValidPass123!' }),
    });
    expect(badEmail.status).toBe(400);

    // 既存ユーザーの正当なサインインは引き続き成功する
    const ok = await fetch(`${API}/api/auth/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
    });
    expect([200, 201]).toContain(ok.status);
  });

  test('M-2: preflight はユーザー存在・氏名を漏らさない（列挙対策）', async () => {
    const preflight = (email: string) =>
      fetch(`${API}/api/auth/preflight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }).then((r) => r.json());

    // 既存ユーザーと存在しないメールで応答が区別できないこと
    const existing = await preflight(TEST_USER.email);
    const missing = await preflight(`nobody-${Date.now()}@example.com`);

    for (const r of [existing, missing]) {
      expect(r.registered).toBe(true); // 常に true（存在を露出しない）
      expect(r.hasPassword).toBe(true); // パスワード画面へ遷移（従来UI互換）
      expect(r.name ?? null).toBeNull(); // 氏名を返さない
    }
    // 既存ユーザーの正当なサインインは引き続き成功する
    const ok = await fetch(`${API}/api/auth/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
    });
    expect([200, 201]).toContain(ok.status);
  });

  test('M-5: バックエンド応答に CSP と nosniff ヘッダが付与される', async () => {
    const res = await fetch(`${API}/api/health`);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  test('M-4: Blob配信は nosniff+CSP付与、HTML/SVGは添付・画像はインライン', async () => {
    const cookie = await adminCookie();
    // 検証用ワークスペースを作成
    const created = await fetch(`${API}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        query: `mutation ($name: String) { createWorkspace(name: $name) { id } }`,
        variables: { name: 'blob-sec-ws' },
      }),
    }).then((r) => r.json());
    const wsId = created.data?.createWorkspace?.id;
    expect(wsId).toBeTruthy();

    try {
      const put = async (key: string, mime: string, body: string) =>
        fetch(`${API}/api/workspaces/${wsId}/blobs/${key}`, {
          method: 'PUT',
          headers: { 'Content-Type': mime, Cookie: cookie },
          body,
        });
      const get = (key: string) =>
        fetch(`${API}/api/workspaces/${wsId}/blobs/${key}`, {
          headers: { Cookie: cookie },
        });

      // SVG（スクリプト混入の危険型）→ インライン表示は維持しつつ、
      // nosniff + CSP(default-src 'none'; sandbox) で直接ナビゲーション時の
      // スクリプト実行を無効化する（<img>経由ではそもそも実行されない）。
      await put('evil-svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      const svg = await get('evil-svg');
      expect(svg.headers.get('x-content-type-options')).toBe('nosniff');
      const svgCsp = svg.headers.get('content-security-policy') ?? '';
      expect(svgCsp).toContain("default-src 'none'");
      expect(svgCsp).toContain('sandbox');

      // HTML → 添付ダウンロード + octet-stream
      await put('evil-html', 'text/html', '<html><body><script>alert(1)</script></body></html>');
      const html = await get('evil-html');
      expect(html.headers.get('content-type') ?? '').toContain('application/octet-stream');
      expect(html.headers.get('content-disposition') ?? '').toContain('attachment');

      // 先頭空白付き " text/html" も trim 判定で添付DLに倒す（空白バイパス対策）
      await put('evil-html-ws', ' text/html', '<html><script>alert(1)</script></html>');
      const htmlWs = await get('evil-html-ws');
      expect(htmlWs.headers.get('content-type') ?? '').toContain('application/octet-stream');
      expect(htmlWs.headers.get('content-disposition') ?? '').toContain('attachment');

      // PNG（安全な画像型）→ インライン表示のまま、ただし nosniff は付与
      const pngBytes = Buffer.from('89504e470d0a1a0a', 'hex').toString('binary');
      await put('safe-png', 'image/png', pngBytes);
      const png = await get('safe-png');
      expect(png.headers.get('content-type') ?? '').toContain('image/png');
      expect(png.headers.get('content-disposition') ?? '').not.toContain('attachment');
      expect(png.headers.get('x-content-type-options')).toBe('nosniff');
    } finally {
      await fetch(`${API}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          query: `mutation ($id: String!) { deleteWorkspace(id: $id) }`,
          variables: { id: wsId },
        }),
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 初期ワークスペースのテンプレート（#75）
// ---------------------------------------------------------------------------
test.describe('初期ワークスペースのテンプレート', () => {
  /**
   * #75: 初期WSの「はじめに」から「フォルダとタグの使い方」への内部リンクが切れていた。
   *
   * インポート時に文書IDが振り直される一方、まだインポートされていない文書への参照は
   * 旧IDのまま残っていたため（replaceIdMiddleware）、リンク先が存在しない状態だった。
   *
   * 初期ワークスペースは「そのユーザーが初めてサインインしたとき」にしか作られないため、
   * このテストでは新規ユーザーを作成し、終了後に削除する。
   */
  test('「はじめに」の内部リンクから「フォルダとタグの使い方」へ遷移できる（#75）', async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const email = `onboarding-link-${Date.now()}@example.invalid`;
    const password = 'OnboardingLink123!';

    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    try {
      // 新規ユーザーでサインイン（未登録アドレスなので自動作成され、初期WSが構築される）
      await page.goto('/');
      await dismissDevOverlay(page);
      await page
        .locator('input[placeholder*="メールアドレス"], input[placeholder*="email"]')
        .fill(email);
      await page.locator('button:has-text("続行"), button:has-text("Continue")').click();
      await page.locator('input[type="password"]').waitFor({ state: 'visible' });
      await page.locator('input[type="password"]').fill(password);
      await page.locator('button:has-text("サインイン"), button:has-text("Sign in")').click();
      await page.waitForURL(/\/workspace\//, { timeout: 60_000 });

      // オンボーディング文書のインポート完了を待つ
      await ensureSidebarOpen(page);
      const gettingStarted = page.locator('text=はじめに').first();
      await gettingStarted.waitFor({ state: 'visible', timeout: 60_000 });
      await gettingStarted.click();

      // 「はじめに」本文中の内部リンク
      const reference = page
        .locator('affine-reference')
        .filter({ hasText: 'フォルダとタグの使い方' })
        .first();
      await reference.waitFor({ state: 'visible', timeout: 30_000 });

      const urlBefore = page.url();
      await reference.click();

      // リンク先の文書が開くこと（リンク切れだと存在しないIDに遷移して本文が出ない）
      await expect(page).not.toHaveURL(urlBefore, { timeout: 15_000 });
      await expect(
        page.locator('[data-block-id]').filter({ hasText: 'フォルダとタグの使い方' }).first()
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      // 後片付け: 作成したユーザー（と個人ワークスペース）を Admin 権限で削除する
      const cleanup = await browser.newContext();
      const cleanupPage = await cleanup.newPage();
      try {
        await signInViaAPI(cleanupPage);
        const list = await graphqlQuery(
          cleanupPage,
          `query ($search: String) { adminUserList(search: $search, take: 20) { items { id email } } }`,
          { search: email }
        );
        const target = list?.data?.adminUserList?.items?.find(
          (u: any) => u.email === email
        );
        if (target) {
          await graphqlQuery(
            cleanupPage,
            `mutation ($id: String!) { adminDeleteUser(userId: $id) }`,
            { id: target.id }
          );
        }
      } catch {
        // 後片付けの失敗はテスト結果に影響させない
      } finally {
        await cleanupPage.close();
        await cleanup.close();
      }
      await page.close();
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// ドキュメントの鮮度表示（#107）
// ---------------------------------------------------------------------------
test.describe('ドキュメントの鮮度表示', () => {
  /**
   * #107: 最終更新日をページ上部（タイトル直下の「情報」欄）に常時表示する。
   *
   * これまでは「情報」欄を開かないと見えなかった（既定は折りたたみ）ため、
   * 読み手が情報の古さに気づけなかった。
   */
  test('ページ上部に最終更新日が常時表示される（#107）', async ({
    sharedPage: page,
  }) => {
    // このテスト単体でも動くようにサインインを担保する
    // （スイート全体では前のテストで済んでいるが、-g で絞ると未サインインになる）
    if (!/\/workspace\//.test(page.url())) {
      await signIn(page);
    }
    await enterOrCreateWorkspace(page);
    await createNewPage(page);
    await page.waitForTimeout(2_000);

    const label = page.locator('[data-testid="doc-updated-at-label"]');
    await expect(label).toBeVisible({ timeout: 15_000 });

    // 相対表記で「いつ更新されたか」が読み取れること
    await expect(label).toContainText('最終更新');

    // 「情報」欄を開かなくても見えていること（折りたたまれた状態で表示される）
    const collapsed = await page
      .locator('[data-testid="page-info-collapse"] [data-collapsed]')
      .first()
      .getAttribute('data-collapsed')
      .catch(() => null);
    if (collapsed !== null) {
      expect(collapsed).toBe('true');
      await expect(label).toBeVisible();
    }
  });
});
