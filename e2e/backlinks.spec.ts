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
 * #101: ⚠️ **A から B へリンクを張ると、B のバックリンクに A が出る。**
 *
 * 以前は索引（`search_index`）にリンク先の列が無く、バックリンクの取得は
 * 毎回 500（42703）で失敗していた。さらに索引は保存時に更新されず、
 * 手動の作り直しでしか変わらなかった（docs/search-index.md）。
 *
 * ⚠️ **画面ではなくサーバーの応答を見る。**
 * 直したのは索引・列・巡回とすべてサーバー側で、画面は AFFiNE のまま。
 * 画面はバックリンクの欄が「見えたとき」に取りに行く作りで、
 * 自動操作からその契機を安定して起こせない（2026-09-17 に確認）。
 */
const BACKLINK_QUERY = `
  query ($ws: String!, $input: AggregateInput!) {
    workspace(id: $ws) {
      aggregate(input: $input) {
        buckets { key count hits { nodes { fields } } }
      }
    }
  }
`;

const backlinkInput = (docId: string) => ({
  table: 'block',
  field: 'docId',
  query: {
    type: 'boolean',
    occur: 'must',
    queries: [{ type: 'match', field: 'refDocId', match: docId }],
  },
  options: {
    hits: {
      fields: ['docId', 'blockId', 'markdownPreview', 'parentFlavour'],
      pagination: { limit: 5 },
    },
    pagination: { limit: 10 },
  },
});

test.describe('バックリンク（#101）', () => {
  test('⚠️ リンクを張ると、リンク先のバックリンクに参照元が出る', async ({ page }) => {
    test.setTimeout(180_000);

    await signIn(page);
    await enterOrCreateWorkspace(page);
    await dismissDevOverlay(page);
    const wsId = await getOwnedWorkspaceId(page);
    expect(wsId).toBeTruthy();
    if (!wsId) return;

    // ⚠️ 題は毎回変える。同じ語だと @ の候補で前回の実行のページを選んでしまう
    const stamp = Date.now();
    const targetTitle = `被リンク先${stamp}`;
    const sourceTitle = `リンク元${stamp}`;

    // --- リンク先のページ B
    await createNewPage(page);
    await expect(page.locator('[data-block-is-title]')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-block-is-title]').click();
    await page.keyboard.type(targetTitle);
    await page.waitForTimeout(2_000);
    const targetDocId = page.url().split('/').pop()!.split('?')[0];

    // --- リンク元のページ A から B へリンクする
    await createNewPage(page);
    await expect(page.locator('[data-block-is-title]')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-block-is-title]').click();
    await page.keyboard.type(sourceTitle);
    // ⚠️ リンクを張る前に控える。候補を選ぶと画面がリンク先へ移ることがあり、
    // 後で URL から取ると**リンク先の ID**を掴む
    const sourceDocId = page.url().split('/').pop()!.split('?')[0];
    await page.keyboard.press('Enter');
    await page.keyboard.type('@');
    await page.keyboard.type(targetTitle);

    // ⚠️ 候補は「既存のページ」を **data-id（ページの ID）** で選ぶ。
    //   - 1件目を押すと、同じ語の**前回の実行のページ**を選ぶことがある
    //   - 題で絞ると「新しい『題』」（新規作成）の候補にも一致し、
    //     **別のページが作られる**（2026-09-17 に実際に踏んだ）
    const candidate = page.locator(
      `affine-linked-doc-popover icon-button[data-id="${targetDocId}"]`
    );
    await expect(candidate).toBeVisible({ timeout: 20_000 });
    await candidate.click();
    await expect(page.locator('affine-reference').first()).toBeVisible({ timeout: 15_000 });

    // --- サーバーの応答で確かめる。
    // ⚠️ 索引は「静まってから」作り直される（既定3秒）ので、出るまで待つ
    await expect
      .poll(
        async () => {
          const res = await graphqlQuery(page, BACKLINK_QUERY, {
            ws: wsId,
            input: backlinkInput(targetDocId),
          });
          const buckets = res?.data?.workspace?.aggregate?.buckets ?? [];
          return buckets.map((b: { key: string }) => b.key);
        },
        { timeout: 90_000, intervals: [3_000] }
      )
      .toContain(sourceDocId);

    // 画面に出すための文が空でないこと（空だと画面は参照を表示しない）
    const res = await graphqlQuery(page, BACKLINK_QUERY, {
      ws: wsId,
      input: backlinkInput(targetDocId),
    });
    const bucket = res.data.workspace.aggregate.buckets.find(
      (b: { key: string }) => b.key === sourceDocId
    );
    expect(bucket.count).toBeGreaterThan(0);
    expect(bucket.hits.nodes[0].fields.markdownPreview).not.toBe('');
  });

  test('リンクしていないページには、バックリンクが出ない', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await enterOrCreateWorkspace(page);
    await dismissDevOverlay(page);
    const wsId = await getOwnedWorkspaceId(page);
    if (!wsId) return;

    await createNewPage(page);
    await expect(page.locator('[data-block-is-title]')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-block-is-title]').click();
    await page.keyboard.type(`孤立ページ${Date.now()}`);
    await page.waitForTimeout(5_000);
    const docId = page.url().split('/').pop()!.split('?')[0];

    const res = await graphqlQuery(page, BACKLINK_QUERY, {
      ws: wsId,
      input: backlinkInput(docId),
    });
    expect(res.data.workspace.aggregate.buckets).toEqual([]);
  });
});
