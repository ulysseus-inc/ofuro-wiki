import { test, expect, devices } from '@playwright/test';

/**
 * #105: スマホ版（`apps/mobile`）の基本動作。
 *
 * ⚠️ **PC 版とは別のビルド**なので、このテストは
 * `cd frontend && yarn dev -p mobile` で起動しているときだけ通る
 * （PC 版が動いているときに走らせると落ちる）。docs/mobile.md 参照。
 *
 * ⚠️ スマホ版は書いてあるだけで一度も動かしておらず、
 * `VirtualKeyboardProvider` の欠落で画面を描く前に落ちていた。
 * このテストは、その回帰を検知するための網。
 */
const USER = { email: 'e2e-test@ofuro-wiki.local', password: 'E2eTestPass123!' };

test.use({ ...devices['iPhone 13'] });

test.describe('スマホ版の基本動作（#105）', () => {
  test('⚠️ サインイン → ページ作成 → 入力 → 検索が動く', async ({ page }) => {
    const res = await page.request.post('/api/auth/sign-in', {
      data: USER,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.ok()).toBe(true);

    // --- ワークスペースの画面が描けること（落ちないこと）
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/workspace\//, { timeout: 30_000 });
    await expect(page.getByText('クイック検索')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);

    // --- ページを作って入力する
    // ⚠️ 下のタブを aria-label で押す。ホームの「新規ドキュメント」（お気に入りに
    // 追加する行）と文字が同じで、getByText だと取り違える
    await page.getByLabel('新規ドキュメント').click();
    // ⚠️ 固定時間で待たない。ページの URL に変わるまで待つ
    await page.waitForURL(/\/workspace\/[^/]+\/(?!home)[^/]+/, { timeout: 30_000 });
    // ⚠️ 検索語は切れ目のない語にする。途中で切った語や空白入りだと、
    // 全文検索の語の切り出しに合わず見つからない
    const keyword = 'スマホ';
    const title = `${keyword}E2E ${Date.now()}`;
    await page.locator('[data-block-is-title]').click({ timeout: 30_000 });
    await page.keyboard.type(title);
    await page.keyboard.press('Enter');
    await page.keyboard.type('スマホから入力した本文');
    await expect(page.locator('affine-page-root')).toContainText(
      'スマホから入力した本文',
      { timeout: 15_000 }
    );

    // --- 検索できる（ホームへ戻ってから。'/' は直前のページへ戻るため URL を直接開く）
    const wsId = page.url().split('/workspace/')[1].split('/')[0];
    await page.goto(`/workspace/${wsId}/home`, { waitUntil: 'domcontentloaded' });
    const searchBox = page.getByText('クイック検索').first();
    await expect(searchBox).toBeVisible({ timeout: 30_000 });

    // ⚠️ ホームの検索欄は要素をクリックできない作りなので、位置をたたいて
    // 検索の画面へ移り、そこの入力欄へ直接書き込む
    const box = await searchBox.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    }
    // ⚠️ 検索の画面は自動で入力欄に焦点が当たる。そのまま打ち込む
    // （fill だと別の入力欄を掴むことがある）
    await page.waitForTimeout(2_000);
    await page.keyboard.type(keyword);

    // 作りたてのページが索引に載るまで間があるため、少し待つ
    await expect(page.getByText(keyword).first()).toBeVisible({ timeout: 30_000 });
  });

  /**
   * ⚠️ **空のページを増やさない。**
   * 新規ドキュメントのタブは押すたびに作るため、押した回数だけ題も本文も無い
   * ページが残っていた（利用者の指摘・2026-09-16）。
   * 題も本文も空のページが既にあるなら、それを開く。
   */
  test('⚠️ 新規ドキュメントを続けて押しても、空のページは増えない', async ({ page }) => {
    const res = await page.request.post('/api/auth/sign-in', {
      data: USER,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.ok()).toBe(true);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/workspace\//, { timeout: 30_000 });
    await expect(page.getByText('クイック検索')).toBeVisible({ timeout: 30_000 });
    const wsId = page.url().split('/workspace/')[1].split('/')[0];

    // 1回目: 空のページが作られる
    await page.getByLabel('新規ドキュメント').click();
    await page.waitForURL(/\/workspace\/[^/]+\/(?!home)[^/]+/, { timeout: 30_000 });
    const firstDocId = page.url().split('/').pop();

    // ホームへ戻ってから、もう一度押す。
    // ⚠️ 下のタブで戻る（利用者と同じ経路）。ページを再読み込みすると、
    // 作りたてのページがまだ一覧に載っておらず、候補に入らないことがある
    await page.locator('#app-tabs a[href$="/home"]').click();
    await expect(page.getByText('クイック検索')).toBeVisible({ timeout: 30_000 });
    await page.getByLabel('新規ドキュメント').click();
    await page.waitForURL(/\/workspace\/[^/]+\/(?!home)[^/]+/, { timeout: 30_000 });

    // 2回目は作らず、さっきの空のページを開く
    expect(page.url().split('/').pop()).toBe(firstDocId);
  });

  /**
   * ⚠️ 「アプリ版」は製品の版数（frontend/package.json）を出す。
   * 以前はアプリのパッケージの版（AFFiNE 由来の 0.26.x）を出しており、
   * リリースしても変わらなかった（#105）。
   */
  test('⚠️ 設定の「アプリ版」が AFFiNE 由来の版数ではない', async ({ page }) => {
    const res = await page.request.post('/api/auth/sign-in', {
      data: USER,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.ok()).toBe(true);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/workspace\//, { timeout: 30_000 });
    await page.locator('[data-testid="settings-button"]').click({ timeout: 30_000 });

    // ⚠️ 版数が描かれるまで待つ。期待値は frontend/package.json の version
    // （開発中は 0.1.0-dev）。ここでは「AFFiNE 由来の 0.26.x でないこと」を見る
    await expect
      .poll(
        async () => {
          const text = await page.evaluate(() => document.body.innerText);
          return /アプリ版\s*([0-9]+\.[0-9]+\.[0-9]+[^\s]*)/.exec(text)?.[1] ?? null;
        },
        { timeout: 20_000, intervals: [1_000] }
      )
      .not.toBeNull();

    const shown = await page.evaluate(() => {
      const text = document.body.innerText;
      return /アプリ版\s*([0-9]+\.[0-9]+\.[0-9]+[^\s]*)/.exec(text)?.[1] ?? '';
    });
    expect(shown).not.toMatch(/^0\.26\./);
  });

  /**
   * ⚠️ **文字だけで「空」と判定しない。**
   * 画像・添付・埋め込みは文字を持たないため、文字だけを見ると
   * 「画像1枚のページ」が空と判定され、タブでそのページが開いてしまう
   * （レビュー指摘）。ここでは文字を持たないブロックの代表として区切り線で見る。
   */
  test('⚠️ 文字が無くても中身があるページは、空とみなさない', async ({ page }) => {
    const res = await page.request.post('/api/auth/sign-in', {
      data: USER,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.ok()).toBe(true);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/workspace\//, { timeout: 30_000 });
    await expect(page.getByText('クイック検索')).toBeVisible({ timeout: 30_000 });
    const wsId = page.url().split('/workspace/')[1].split('/')[0];

    // 1回目: 空のページを開き、題は付けずに区切り線だけ入れる
    await page.getByLabel('新規ドキュメント').click();
    await page.waitForURL(/\/workspace\/[^/]+\/(?!home)[^/]+/, { timeout: 30_000 });
    const withDividerId = page.url().split('/').pop();

    await page.locator('[data-block-is-title]').click({ timeout: 30_000 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('--- ');
    await expect(page.locator('affine-divider')).toHaveCount(1, { timeout: 15_000 });
    // ⚠️ 画面に出てから保存されるまで間がある。すぐ移ると判定に間に合わない
    await page.waitForTimeout(3_000);

    // 2回目: 区切り線のページは「空」ではないので、新しいページになる
    await page.goto(`/workspace/${wsId}/home`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('クイック検索')).toBeVisible({ timeout: 30_000 });
    await page.getByLabel('新規ドキュメント').click();
    await page.waitForURL(/\/workspace\/[^/]+\/(?!home)[^/]+/, { timeout: 30_000 });

    expect(page.url().split('/').pop()).not.toBe(withDividerId);
  });
});
