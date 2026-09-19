import { test, expect } from '@playwright/test';
import {
  createNewPage,
  dismissDevOverlay,
  enterOrCreateWorkspace,
  getOwnedWorkspaceId,
  graphqlQuery,
  signIn,
} from './helpers';

/**
 * #248: ⚠️ **キャンバス（エッジレス）に描いた図形のラベルが検索に出る。**
 *
 * 図形のラベルは `affine:surface` の `prop:elements` に入り、ブロックではない。
 * 索引はブロックだけを辿っていたため、**フロー図の中身がまるごと漏れていた**。
 *
 * ⚠️ **画面ではなくサーバーの応答を見る。** 直したのは索引側で、
 * 画面（検索の窓）は同じ結果を映すだけ。
 */
const SEARCH = `
  query ($ws: String!, $input: SearchDocsInput!) {
    workspace(id: $ws) { searchDocs(input: $input) { docId title } }
  }
`;

test.describe('キャンバスの文字の検索（#248）', () => {
  test('⚠️ 図形に書いた文字が検索に出る', async ({ page }) => {
    test.setTimeout(180_000);

    await signIn(page);
    await enterOrCreateWorkspace(page);
    await dismissDevOverlay(page);
    const wsId = await getOwnedWorkspaceId(page);
    expect(wsId).toBeTruthy();
    if (!wsId) return;

    // ⚠️ 語は毎回変える。前回の実行の残骸を拾わないため
    const label = `図形ラベル${Date.now()}`;

    await createNewPage(page);
    await expect(page.locator('[data-block-is-title]')).toBeVisible({
      timeout: 15_000,
    });
    await page.locator('[data-block-is-title]').click();
    await page.keyboard.type(`キャンバスの検査${Date.now()}`);
    const docId = page.url().split('/').pop()!.split('?')[0];
    await page.waitForTimeout(2_000);

    // エッジレスへ切り替える
    const toEdgeless = page.locator('[data-testid="switch-edgeless-mode-button"]');
    await expect(toEdgeless).toBeVisible({ timeout: 15_000 });
    await toEdgeless.click();
    await page.waitForTimeout(5_000);

    // 図形を置いて、中に文字を書く
    await page.keyboard.press('s');
    await page.waitForTimeout(800);
    await page.mouse.move(900, 500);
    await page.mouse.down();
    await page.mouse.move(1120, 660);
    await page.mouse.up();
    await page.waitForTimeout(1_500);

    await page.keyboard.press('Escape');
    await page.mouse.dblclick(1010, 580);
    await page.waitForTimeout(1_500);
    await page.keyboard.type(label, { delay: 40 });
    await page.keyboard.press('Escape');

    // ⚠️ 索引は「静まってから」作り直される（既定3秒）ので、出るまで待つ
    await expect
      .poll(
        async () => {
          const res = await graphqlQuery(page, SEARCH, {
            ws: wsId,
            input: { keyword: label, limit: 10 },
          });
          const docs = res?.data?.workspace?.searchDocs ?? [];
          return docs.map((d: { docId: string }) => d.docId);
        },
        { timeout: 90_000, intervals: [3_000] }
      )
      .toContain(docId);
  });
});
