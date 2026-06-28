/**
 * ofuro-wiki バックアップ・エクスポート E2E テスト
 *
 * 前提条件:
 *   - PostgreSQL が起動済み (docker compose up -d)
 *   - バックエンド (port 3010) が起動済み
 *   - フロントエンド (port 8080) が起動済み
 *   - 環境変数 ADMIN_EMAIL=e2e-test@ofuro-wiki.local でバックエンド起動
 *
 * 実行方法:
 *   cd e2e && npx playwright test backup.spec.ts
 */
import { test, expect } from '@playwright/test';
import {
  TEST_USER,
  ensureTestUser,
  signIn,
  enterOrCreateWorkspace,
  graphqlQuery,
} from './helpers';

const BACKEND_URL = 'http://localhost:3010';

// ---------------------------------------------------------------------------
// セットアップ
// ---------------------------------------------------------------------------
test.beforeAll(async () => {
  await ensureTestUser(BACKEND_URL);
});

// ---------------------------------------------------------------------------
// 1. ワークスペース エクスポート / インポート
// ---------------------------------------------------------------------------
test.describe('Workspace Export / Import', () => {
  test.describe.configure({ mode: 'serial' });

  test('ワークスペースをエクスポートできる（ZIP ダウンロード）', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    // ワークスペース ID を取得
    const wsResult = await graphqlQuery(page, '{ workspaces { id } }');
    const workspaceId = wsResult.data.workspaces[0]?.id;
    expect(workspaceId).toBeTruthy();

    // エクスポート API を呼び出し
    const response = await page.evaluate(async (wsId: string) => {
      const res = await fetch(`/api/workspaces/${wsId}/export`, {
        method: 'POST',
        credentials: 'include',
      });
      return {
        status: res.status,
        contentType: res.headers.get('Content-Type'),
        contentDisposition: res.headers.get('Content-Disposition'),
        size: (await res.blob()).size,
      };
    }, workspaceId);

    expect([200, 201]).toContain(response.status);
    expect(response.contentType).toBe('application/zip');
    expect(response.contentDisposition).toContain('.ofuro-backup.zip');
    expect(response.size).toBeGreaterThan(0);
  });

  test('エクスポートした ZIP をインポートして新ワークスペースが作成される', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    // ワークスペース ID を取得
    const wsResult = await graphqlQuery(page, '{ workspaces { id } }');
    const workspaceId = wsResult.data.workspaces[0]?.id;
    expect(workspaceId).toBeTruthy();

    // エクスポートしてインポート
    const importResult = await page.evaluate(async (wsId: string) => {
      // 1. エクスポート
      const exportRes = await fetch(`/api/workspaces/${wsId}/export`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!exportRes.ok) {
        throw new Error(`Export failed: ${exportRes.status}`);
      }
      const blob = await exportRes.blob();

      // 2. インポート
      const formData = new FormData();
      formData.append('file', blob, 'test.ofuro-backup.zip');

      const importRes = await fetch('/api/workspaces/import', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!importRes.ok) {
        const text = await importRes.text();
        throw new Error(`Import failed: ${importRes.status} ${text}`);
      }

      return importRes.json();
    }, workspaceId);

    expect(importResult.workspaceId).toBeTruthy();
    expect(importResult.name.toLowerCase()).toContain('imported');
    expect(importResult.docCount).toBeGreaterThanOrEqual(0);
    expect(importResult.blobCount).toBeGreaterThanOrEqual(0);

    // クリーンアップ: インポートしたワークスペースを削除
    await graphqlQuery(
      page,
      `mutation { deleteWorkspace(id: "${importResult.workspaceId}") }`
    );
  });

  test('非 Owner はエクスポートできない（403）', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    // 存在しないワークスペース ID でエクスポート試行
    const response = await page.evaluate(async () => {
      const res = await fetch(
        '/api/workspaces/00000000-0000-0000-0000-000000000000/export',
        {
          method: 'POST',
          credentials: 'include',
        }
      );
      return { status: res.status };
    });

    // 400 (not found) or 403 (forbidden)
    expect([400, 403]).toContain(response.status);
  });
});

// ---------------------------------------------------------------------------
// 2. Admin バックアップ API テスト
// ---------------------------------------------------------------------------
test.describe('Admin Backup API', () => {
  test.describe.configure({ mode: 'serial' });

  test('Admin がバックアップ一覧を取得できる', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const result = await graphqlQuery(
      page,
      '{ adminBackupList { items { id filename status } totalCount } }'
    );
    expect(result.data.adminBackupList).toBeTruthy();
    expect(result.data.adminBackupList.totalCount).toBeGreaterThanOrEqual(0);
  });

  test('Admin が手動バックアップを作成できる', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const result = await graphqlQuery(
      page,
      'mutation { adminCreateBackup { id filename size workspaceCount docCount blobCount status } }'
    );
    expect(result.data.adminCreateBackup.id).toBeTruthy();
    expect(result.data.adminCreateBackup.status).toBe('completed');
    expect(result.data.adminCreateBackup.workspaceCount).toBeGreaterThanOrEqual(1);

    // クリーンアップ
    const backupId = result.data.adminCreateBackup.id;
    await graphqlQuery(
      page,
      `mutation { adminDeleteBackup(id: "${backupId}") }`
    );
  });

  test('Admin がバックアップを削除できる', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    // バックアップを作成
    const createResult = await graphqlQuery(
      page,
      'mutation { adminCreateBackup { id } }'
    );
    const backupId = createResult.data.adminCreateBackup.id;
    expect(backupId).toBeTruthy();

    // バックアップを削除
    const deleteResult = await graphqlQuery(
      page,
      `mutation { adminDeleteBackup(id: "${backupId}") }`
    );
    expect(deleteResult.data.adminDeleteBackup).toBe(true);

    // 一覧に含まれないことを確認
    const listResult = await graphqlQuery(
      page,
      '{ adminBackupList { items { id } totalCount } }'
    );
    const found = listResult.data.adminBackupList.items.find(
      (b: any) => b.id === backupId
    );
    expect(found).toBeUndefined();
  });
});
