import { test, expect } from '@playwright/test';
import {
  dismissDevOverlay,
  enterOrCreateWorkspace,
  getOwnedWorkspaceId,
  signIn,
} from './helpers';

/**
 * #250: ⚠️ **内部APIで作ったページも、エッジレスで開ける。**
 *
 * 組み立て側（`yjs-doc-builder.ts`）が `affine:surface` を作っておらず、
 * 内部API で入れたページ（マニュアル・デモのシード・移行分）は
 * エッジレスモードで開くと**真っ白になって落ちていた**（2026-09-19）。
 *
 * ```
 * This doc is missing surface block in edgeless.
 * TypeError: Cannot read properties of undefined (reading 'children')
 * ```
 *
 * ⚠️ **単体テストだけでは足りない。** `prop:elements` の形が違っても
 * 画面は**黙って無視して同じ症状になる**ため、実際に開くところまで見る。
 */
test.describe('内部APIで作ったページのエッジレス（#250）', () => {
  test('⚠️ エッジレスで開いても落ちない', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await enterOrCreateWorkspace(page);
    await dismissDevOverlay(page);
    const wsId = await getOwnedWorkspaceId(page);
    expect(wsId).toBeTruthy();
    if (!wsId) return;

    const docId = `edgeless-check-${Date.now()}`;
    const res = await page.request.post('/api/internal/docs/upsert', {
      data: {
        workspaceId: wsId,
        docId,
        title: 'エッジレスで開けること',
        markdown: '## 見出し\n本文です',
      },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.ok()).toBe(true);

    // ⚠️ 画面の落ちを拾う。surface が無いと pageerror が飛ぶ
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(`/workspace/${wsId}/${docId}`);
    await page.waitForTimeout(8_000);

    await page.locator('[data-testid="switch-edgeless-mode-button"]').first().click();
    await page.waitForTimeout(6_000);

    expect(errors.join('\n')).not.toContain('missing surface block');
    // キャンバスの道具が出ていれば、描ける状態になっている
    await expect(page.locator('edgeless-toolbar-widget')).toHaveCount(1);
  });
});
