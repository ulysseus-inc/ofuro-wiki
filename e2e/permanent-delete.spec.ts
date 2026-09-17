import { test, expect } from '@playwright/test';
import {
  createNewPage,
  dismissDevOverlay,
  ensureSidebarOpen,
  enterOrCreateWorkspace,
  getOwnedWorkspaceId,
  graphqlQuery,
  signIn,
} from './helpers';

/**
 * #45: ⚠️ **完全に削除したページは、検索からも消える。**
 *
 * 以前はサーバーが台帳（`doc_meta`）の行しか消しておらず、本文と索引が
 * 残っていた。索引が残った doc は権限を引けずに
 * 「ワークスペースのメンバーなら読める」に落ちるため、
 * **消したページの本文が検索結果に出続けていた**（docs/permanent-delete.md 4章）。
 *
 * ⚠️ **画面ではなくサーバーの応答を見る。** 直したのはサーバー側で、
 * 画面の一覧は消した直後に消えるため、画面だけでは残骸を見つけられない。
 */
const SEARCH_QUERY = `
  query ($ws: String!, $input: SearchDocsInput!) {
    workspace(id: $ws) {
      searchDocs(input: $input) { docId }
    }
  }
`;

const foundDocIds = async (page: any, wsId: string, keyword: string) => {
  const res = await graphqlQuery(page, SEARCH_QUERY, {
    ws: wsId,
    input: { keyword, limit: 20 },
  });
  const docs = res?.data?.workspace?.searchDocs ?? [];
  return docs.map((d: { docId: string }) => d.docId);
};

test.describe('完全削除（#45）', () => {
  test('⚠️ 完全に削除すると、検索からも消える', async ({ page }) => {
    test.setTimeout(180_000);

    await signIn(page);
    await enterOrCreateWorkspace(page);
    await dismissDevOverlay(page);
    const wsId = await getOwnedWorkspaceId(page);
    expect(wsId).toBeTruthy();
    if (!wsId) return;

    // ⚠️ 語は毎回変える。前回の実行の残骸を拾うと、
    // 消えていないのに「消えた」と読めてしまう
    const keyword = `完全削除の検査${Date.now()}`;

    await createNewPage(page);
    await expect(page.locator('[data-block-is-title]')).toBeVisible({
      timeout: 15_000,
    });
    await page.locator('[data-block-is-title]').click();
    await page.keyboard.type(keyword);
    const docId = page.url().split('/').pop()!.split('?')[0];

    // --- まず索引に載ることを確かめる。
    // ⚠️ これが無いと、そもそも載っていないだけの状態を
    // 「消えた」と取り違える（#101 の索引は静まってから作り直す）
    await expect
      .poll(() => foundDocIds(page, wsId, keyword), {
        timeout: 60_000,
        intervals: [3_000],
      })
      .toContain(docId);

    // --- ゴミ箱へ
    await page.locator('[data-testid="header-dropDownButton"]').click();
    await page.locator('[data-testid="editor-option-menu-delete"]').click();
    await page.locator('[data-testid="confirm-modal-confirm"]').click();
    await page.waitForTimeout(2_000);

    // --- ゴミ箱から完全に削除
    await ensureSidebarOpen(page);
    await page.locator('[data-testid="trash-page"]').click();
    const row = page.locator(`[data-doc-id="${docId}"]`).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.hover();
    await row.locator('[data-testid="delete-page-button"]').click();
    await page.locator('[data-testid="confirm-modal-confirm"]').click();

    // --- サーバーの応答で確かめる
    await expect
      .poll(() => foundDocIds(page, wsId, keyword), {
        timeout: 60_000,
        intervals: [3_000],
      })
      .not.toContain(docId);
  });
});
