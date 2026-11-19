/**
 * M4: 監査ログ（docs/logging.md 2.11・2.12）
 *
 * | 見ること | 仕様 |
 * |---|---|
 * | 閲覧の記録は、有効にするときだけ確認の窓が出る | 2.11 |
 * | 閲覧は、有効なときだけ・1 日 1 件・共有だけ残る | 2.11 |
 * | フォルダの操作（CLI と画面）が残る。並べ替え・中身の削除は 1 件ずつ残らない | 2.12 |
 *
 * ⚠️ 閲覧の記録の設定は開発環境の設定。各テストの最後に必ず「記録しない」に戻す。
 *
 * 前提: CLI を事前にビルドしておく
 *   cd frontend && node packages/common/agent-cli/esbuild.config.js
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { test, expect, type Page } from '@playwright/test';
import {
  addToShared,
  adminCookieFor,
  createNewPage,
  deleteWorkspaceAsAdmin,
  dismissDevOverlay,
  ensureSidebarOpen,
  ensureTestUser,
  getOwnedWorkspaceId,
  importSharedWorkspace,
  signInViaAPI,
  TEST_USER,
  waitForWorkspaceInitialized,
} from './helpers';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const API = process.env.API_URL || 'http://localhost:3010';
const CLI = path.resolve(__dirname, '../skills/ofuro-wiki-cli/scripts/ofuro.mjs');
const DOC_VIEW_SETTING = 'audit_log_doc_view_enabled';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

let admin: string;

async function gql(query: string, variables?: Record<string, unknown>) {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: admin },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  expect(json.errors, JSON.stringify(json.errors)).toBeUndefined();
  return json.data;
}

async function setDocView(enabled: boolean) {
  await gql(
    `mutation ($k: String!, $v: String!) { adminUpdateServerSetting(key: $k, value: $v) { key } }`,
    { k: DOC_VIEW_SETTING, v: String(enabled) },
  );
}

async function docViewSetting(): Promise<string | undefined> {
  const data = await gql(`{ adminServerSettings { key value } }`);
  return data.adminServerSettings.find((s: { key: string }) => s.key === DOC_VIEW_SETTING)?.value;
}

interface AuditRow {
  action: string;
  targetId?: string;
  targetName?: string;
  workspaceId?: string;
  detail?: { before?: Record<string, unknown>; after?: Record<string, unknown>; meta?: Record<string, unknown> };
}

/** そのワークスペースの、action が前方一致する記録（新しい順） */
async function auditOf(workspaceId: string, action: string): Promise<AuditRow[]> {
  const data = await gql(
    `query ($a: String) { adminAuditLogs(action: $a, take: 200) { items { action targetId targetName workspaceId detail } } }`,
    { a: action },
  );
  return data.adminAuditLogs.items.filter((i: AuditRow) => i.workspaceId === workspaceId);
}

/** ページを開いて、その docId を返す */
async function openNewPage(page: Page, wsId: string): Promise<string> {
  await page.goto(`${BASE}/workspace/${wsId}/all`);
  await dismissDevOverlay(page);
  await waitForWorkspaceInitialized(page);
  await createNewPage(page);
  await page.waitForURL(new RegExp(`/workspace/${wsId}/(?!all)[^/?]+`), { timeout: 30_000 });
  await page.keyboard.type('閲覧の記録');
  return page.url().split('/workspace/')[1].split('/')[1].split('?')[0];
}

test.beforeAll(async () => {
  await ensureTestUser(BASE);
  admin = await adminCookieFor(API);
});

test.afterAll(async () => {
  await setDocView(false);
});

test.describe('ページの閲覧 (#100)', () => {
  test('【重要】有効にするときだけ確認の窓が出る。キャンセルなら変わらない', async ({ page }) => {
    await setDocView(false);
    await signInViaAPI(page);
    await page.goto(`${BASE}/`);
    await page.waitForURL(/\/workspace\//, { timeout: 30_000 });
    await dismissDevOverlay(page);
    await waitForWorkspaceInitialized(page);

    // 管理画面 → サーバー設定
    await ensureSidebarOpen(page);
    await page.locator('[data-testid="sidebar-user-avatar"]').click({ force: true });
    await page.locator('[data-testid="workspace-modal-account-admin-option"]').click();
    await page.locator('[data-testid="admin-settings-trigger"]').click();
    const toggle = page.getByTestId('doc-view-switch');
    await expect(toggle).toBeVisible({ timeout: 15_000 });

    // キャンセル: 変わらない
    await toggle.click();
    await expect(page.getByTestId('doc-view-confirm')).toBeVisible();
    await page.getByRole('button', { name: 'キャンセル' }).click();
    await expect(page.getByTestId('doc-view-confirm')).toHaveCount(0);
    expect(await docViewSetting()).toBe('false');

    // 記録する
    await toggle.click();
    await page.getByRole('button', { name: '記録する' }).click();
    await expect.poll(docViewSetting).toBe('true');

    // 戻すときは確かめない
    await toggle.click();
    await expect(page.getByTestId('doc-view-confirm')).toHaveCount(0);
    await expect.poll(docViewSetting).toBe('false');
  });

  test('【重要】有効なときだけ、共有での閲覧を 1 日 1 件残す。プライベートは残さない', async ({ page }) => {
    const wsId = await importSharedWorkspace(API, `e2e-m4-view-${Date.now()}`);
    try {
      await setDocView(false);
      await signInViaAPI(page);

      // 記録しない（既定）: 開いても残らない
      const docId = await openNewPage(page, wsId);
      await page.waitForTimeout(3_000);
      expect(await auditOf(wsId, 'doc.view')).toEqual([]);

      // 記録する: 開き直すと 1 件
      await setDocView(true);
      await page.goto(`${BASE}/workspace/${wsId}/${docId}`);
      await expect
        .poll(async () => (await auditOf(wsId, 'doc.view')).filter(r => r.targetId === docId).length, { timeout: 15_000 })
        .toBe(1);

      // 同じ日にもう一度開いても増えない
      await page.goto(`${BASE}/workspace/${wsId}/${docId}`);
      await dismissDevOverlay(page);
      await page.waitForTimeout(5_000);
      expect((await auditOf(wsId, 'doc.view')).filter(r => r.targetId === docId)).toHaveLength(1);

      // プライベート: 残らない
      const privateId = await getOwnedWorkspaceId(page);
      expect(privateId).toBeTruthy();
      await openNewPage(page, privateId!);
      await page.waitForTimeout(5_000);
      expect(await auditOf(privateId!, 'doc.view')).toEqual([]);
    } finally {
      await setDocView(false);
      await deleteWorkspaceAsAdmin(API, wsId);
    }
  });
});

test.describe('フォルダの操作 (#283)', () => {
  const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ofuro-cli-e2e-m4-'));

  test.afterAll(() => {
    fs.rmSync(cliHome, { recursive: true, force: true });
  });

  function cli(wsId: string, args: string[], input?: string): string {
    return execFileSync('node', [CLI, ...args], {
      input,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: cliHome,
        OFURO_URL: `${BASE}/workspace/${wsId}`,
        OFURO_EMAIL: TEST_USER.email,
        OFURO_PASSWORD: TEST_USER.password,
      },
    });
  }

  /** サイドバーのフォルダのメニューを開く */
  async function folderMenu(page: Page, name: string) {
    const node = page.locator('[data-testid^="navigation-panel-folder-"]', { hasText: name }).first();
    await node.hover();
    await node.getByTestId('navigation-panel-tree-node-operation-button').first().click();
  }

  test('【重要】CLI と画面のフォルダの操作が残る。中身ごと消すと 1 件にまとまる', async ({ page }) => {
    expect(fs.existsSync(CLI), `CLI が未ビルド: ${CLI}`).toBe(true);
    const wsId = await importSharedWorkspace(API, `e2e-m4-folder-${Date.now()}`);
    try {
      await addToShared(API, wsId, admin);
      const stamp = Date.now();
      const parent = `監査P${stamp}`;
      const child = `監査C${stamp}`;
      const renamed = `監査R${stamp}`;

      // CLI: 作成・ページの出し入れ
      cli(wsId, ['folder', 'create', parent]);
      cli(wsId, ['folder', 'create', child, '--parent', parent]);
      const created = cli(wsId, ['create', '--title', `監査ページ${stamp}`, '--stdin'], '本文\n');
      const docId = created.match(/docId: (\S+)/)?.[1] as string;
      expect(docId, created).toBeTruthy();
      cli(wsId, ['folder', 'add', parent, docId]);
      cli(wsId, ['folder', 'remove', parent, docId]);
      cli(wsId, ['folder', 'add', child, docId]);

      await expect.poll(async () => (await auditOf(wsId, 'folder.')).map(r => r.action).sort(), { timeout: 15_000 })
        .toEqual(['folder.create', 'folder.create', 'folder.item.add', 'folder.item.add', 'folder.item.remove']);
      const rows = await auditOf(wsId, 'folder.');
      expect(rows.find(r => r.action === 'folder.create' && r.targetName === child)).toBeTruthy();
      expect(rows.find(r => r.action === 'folder.item.remove')).toMatchObject({
        targetId: docId,
        detail: { meta: { folder: parent, type: 'doc' } },
      });

      // 画面: 名前の変更・削除
      await signInViaAPI(page);
      await page.goto(`${BASE}/workspace/${wsId}/all`);
      await dismissDevOverlay(page);
      await waitForWorkspaceInitialized(page);
      await ensureSidebarOpen(page);

      await folderMenu(page, parent);
      await page.getByRole('menuitem', { name: '名前の変更' }).click();
      await page.getByTestId('rename-modal-input').fill(renamed);
      await page.keyboard.press('Enter');
      await expect
        .poll(async () => (await auditOf(wsId, 'folder.rename'))[0]?.detail, { timeout: 15_000 })
        .toEqual({ before: { name: parent }, after: { name: renamed } });

      await folderMenu(page, renamed);
      await page.getByRole('menuitem', { name: '削除' }).click();
      await expect
        .poll(async () => (await auditOf(wsId, 'folder.delete')).length, { timeout: 15_000 })
        .toBe(1);
      await page.waitForTimeout(3_000);

      // 中身（子フォルダ・ページ）は 1 件ずつ残らない
      const deleted = await auditOf(wsId, 'folder.delete');
      expect(deleted[0].targetName).toBe(renamed);
      expect(await auditOf(wsId, 'folder.item.remove')).toHaveLength(1);
    } finally {
      await deleteWorkspaceAsAdmin(API, wsId);
    }
  });
});
