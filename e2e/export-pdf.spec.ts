import { test, expect, type Page } from '@playwright/test';
import {
  createNewPage,
  dismissDevOverlay,
  enterOrCreateWorkspace,
  signIn,
} from './helpers';

/**
 * #104: ⚠️ **PDF は「印刷」を正式な手段とし、試験機能の「PDF に書き出し」は出さない。**
 *
 * 試験機能（`enable_pdfmake_export`）は、フォントを `cdn.affine.pro` から取得する。
 * 外部送信ゼロの方針に反し、閉域では失敗する（docs/oss-egress-verification.md）。
 * `configurable: false` で無効に固定し、**以前に有効にした利用者の保存値も無視する**。
 */

/** 試験機能の保存先（LocalStorageGlobalState の接頭辞 + FLAG_PREFIX） */
const PDFMAKE_FLAG_KEY = 'global-state:affine-flag:enable_pdfmake_export';

/** サインインして新しいページを開く */
async function openNewPage(page: Page) {
  await signIn(page);
  await enterOrCreateWorkspace(page);
  await dismissDevOverlay(page);
  await createNewPage(page);
  await expect(page.locator('[data-block-is-title]')).toBeVisible({ timeout: 10_000 });
}

test.describe('PDF（#104）', () => {
  test('⚠️ 以前に試験機能を有効にした利用者でも「PDF に書き出し」が出ず、「印刷」は出る', async ({
    page,
  }) => {
    // 以前に設定画面で有効にした状態を再現する（アプリの読み込み前に入れる）
    await page.addInitScript((key) => {
      localStorage.setItem(key, 'true');
    }, PDFMAKE_FLAG_KEY);

    await openNewPage(page);

    await page.locator('[data-testid="header-dropDownButton"]').click();
    await page.locator('[data-testid="export-menu"]').click();

    // 「印刷」が出そろってから、「PDF に書き出し」が無いことを見る
    await expect(page.locator('[data-testid="export-to-pdf"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="export-to-pdf-export"]')).toHaveCount(0);
  });

  // 軽微: 翻訳キーが無く英語のまま出ていた2件（#104 の PR に含める）
  test('エクスポートのメニューが日本語で出る', async ({ page }) => {
    await openNewPage(page);

    await page.locator('[data-testid="header-dropDownButton"]').click();
    await expect(page.locator('[data-testid="export-menu"]')).toContainText(
      'エクスポート'
    );

    await page.locator('[data-testid="export-menu"]').click();
    await expect(page.locator('[data-testid="export-to-snapshot"]')).toContainText(
      'スナップショットを保存'
    );
  });
});

/**
 * #102: 見出しから目次が作られる（AFFiNE の OutlinePanel をそのまま使う）。
 * ページ右端の目次から、サイドパネルのアウトラインを開ける。
 */
test.describe('ページ内目次（#102）', () => {
  test('見出しを書くと、サイドパネルのアウトラインに並ぶ', async ({ page }) => {
    await openNewPage(page);

    // 本文に見出しを書く（Markdown の「# 」で見出しになる）
    const heading = `e2e102 見出し ${Date.now()}`;
    await page.locator('[data-block-is-title]').click();
    await page.keyboard.type('e2e102 目次の確認');
    await page.keyboard.press('Enter');
    await page.keyboard.type('# ');
    await page.keyboard.type(heading);

    // ページ右端の目次（affine-outline-viewer）は、見出しがあると出る
    await expect(page.locator('affine-outline-viewer')).toHaveCount(1, { timeout: 10_000 });

    // サイドパネルを開き、アウトラインのタブを選ぶ。
    // ⚠️ 右端の目次はマウスを載せたときだけ広がる作りで、自動操作からは
    // 「見えない」扱いになる。利用者も使うヘッダーの経路で開く
    await page.locator('[data-testid="right-sidebar-toggle"]').click();
    await page.locator('[data-testid="sidebar-tab-outline"]').click();

    await expect(
      page.locator('[data-testid="sidebar-tab-content-outline"] affine-outline-panel')
    ).toContainText(heading, { timeout: 10_000 });
  });
});
