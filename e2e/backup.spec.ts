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
import { test, expect, type Page } from '@playwright/test';
import {
  TEST_USER,
  ensureTestUser,
  signIn,
  enterOrCreateWorkspace,
  getOwnedWorkspaceId,
  graphqlQuery,
} from './helpers';

const BACKEND_URL = 'http://localhost:3010';


/**
 * #79: pg_dump / pg_restore が使えない環境かどうか。
 *
 * バックアップは PostgreSQL クライアントツールを子プロセスで実行するため、
 * ホスト上で開発している場合は未インストールのことがある
 * （Docker イメージには同梱されている）。
 * その場合はテストを失敗ではなく **skip** にして、理由を明示する。
 */
function isPgToolUnavailable(result: any): boolean {
  const messages: string[] = (result?.errors ?? []).map((e: any) => e?.message ?? '');
  return messages.some(m => m.includes('PG_TOOL_UNAVAILABLE'));
}

// ---------------------------------------------------------------------------
// セットアップ
// ---------------------------------------------------------------------------
test.beforeAll(async () => {
  await ensureTestUser(BACKEND_URL);
});

// ---------------------------------------------------------------------------
// 1. ワークスペース エクスポート / インポート
/**
 * #212: ⚠️ 作成は非同期。`adminCreateBackup` は `running` を返し、
 * 完了は一覧の status で知る（docs/backup.md 1章）。
 * 待たずに削除すると、実行中の削除は拒否される（2章）。
 */
async function waitForBackup(page: Page, id: string) {
  let status = '';
  await expect
    .poll(
      async () => {
        const r = await graphqlQuery(
          page,
          '{ adminBackupList(skip: 0, take: 50) { items { id status } } }'
        );
        status =
          r?.data?.adminBackupList?.items?.find((b: any) => b.id === id)?.status ?? '';
        return status;
      },
      { timeout: 180_000, intervals: [2_000] }
    )
    .not.toBe('running');
  return status;
}

// ---------------------------------------------------------------------------
test.describe('Workspace Export / Import', () => {
  test.describe.configure({ mode: 'serial' });

  test('ワークスペースをエクスポートできる（ZIP ダウンロード）', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    // #79: 自分が Owner のワークスペースを選ぶ（マニュアルWSは読み取り専用のため除外）
    const workspaceId = await getOwnedWorkspaceId(page);
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

    // #79: 自分が Owner のワークスペースを選ぶ（マニュアルWSは読み取り専用のため除外）
    const workspaceId = await getOwnedWorkspaceId(page);
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

    // #79: pg_dump が無い開発環境では、失敗ではなく理由を示して skip する
    test.skip(
      isPgToolUnavailable(result),
      'pg_dump が利用できない環境のためスキップ（postgresql-client を導入すると実行されます。docs/development.md 参照）'
    );

    expect(result.data.adminCreateBackup.id).toBeTruthy();
    // #212: ⚠️ 完了を待たずに返る（以前は completed を返していた）
    expect(result.data.adminCreateBackup.status).toBe('running');

    const backupId = result.data.adminCreateBackup.id;
    expect(await waitForBackup(page, backupId)).toBe('completed');

    const list = await graphqlQuery(
      page,
      '{ adminBackupList(skip: 0, take: 50) { items { id workspaceCount } } }'
    );
    const done = list.data.adminBackupList.items.find((b: any) => b.id === backupId);
    expect(done.workspaceCount).toBeGreaterThanOrEqual(1);

    // クリーンアップ
    await graphqlQuery(
      page,
      `mutation { adminDeleteBackup(id: "${backupId}") }`
    );
  });

  /**
   * #212: ⚠️ 以前は「失敗」と出て押し直すと、裏で前の pg_dump が走ったまま
   * 2本目が始まった。実行中の削除も、記録だけ消えて ZIP が残った。
   */
  test('⚠️ 作成中は、2本目の作成と削除を拒否する', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    const first = await graphqlQuery(page, 'mutation { adminCreateBackup { id status } }');
    test.skip(
      isPgToolUnavailable(first),
      'pg_dump が利用できない環境のためスキップ（postgresql-client を導入すると実行されます。docs/development.md 参照）'
    );
    const id = first.data.adminCreateBackup.id;
    expect(first.data.adminCreateBackup.status).toBe('running');

    try {
      const second = await graphqlQuery(page, 'mutation { adminCreateBackup { id } }');
      expect(second.errors?.[0]?.message).toBe('BACKUP_IN_PROGRESS');

      const del = await graphqlQuery(page, `mutation { adminDeleteBackup(id: "${id}") }`);
      expect(del.errors?.[0]?.message).toBe('BACKUP_IN_PROGRESS');
    } finally {
      // 終わってから片付ける（実行中は消せない）
      await waitForBackup(page, id);
      await graphqlQuery(page, `mutation { adminDeleteBackup(id: "${id}") }`);
    }
  });

  test('Admin がバックアップを削除できる', async ({ page }) => {
    await signIn(page);
    await enterOrCreateWorkspace(page);

    // バックアップを作成
    const createResult = await graphqlQuery(
      page,
      'mutation { adminCreateBackup { id } }'
    );

    // #79: pg_dump が無い開発環境では、失敗ではなく理由を示して skip する
    test.skip(
      isPgToolUnavailable(createResult),
      'pg_dump が利用できない環境のためスキップ（postgresql-client を導入すると実行されます。docs/development.md 参照）'
    );

    const backupId = createResult.data.adminCreateBackup.id;
    expect(backupId).toBeTruthy();

    // #212: ⚠️ 実行中の削除は拒否されるので、終わるのを待つ
    expect(await waitForBackup(page, backupId)).toBe('completed');

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

// ---------------------------------------------------------------------------
// 3. 復元（リストア）
// ---------------------------------------------------------------------------
/**
 * ⚠️ **これは「退路」の検証である。**
 *
 * バックアップは作成できても**復元できなければ意味がない**。
 * にもかかわらず、これまで作成・一覧・削除しか検証しておらず、
 * `POST /api/admin/restore` は**一度も動かした実績が無かった**
 * （2026-08-09 に手動で確認するまで）。
 *
 * 本番でデータ消失が起きた事故があり（2026-05-25、本文が回収不能）、
 * 以後バックアップを有効化した。**その退路が生きていることを、
 * 人手ではなくテストで保証する。**
 *
 * ⚠️ **復元は DB を丸ごと入れ替える。** 他のテストが作ったデータも
 * 巻き戻るため、このブロックは**最後に置き、直列で実行する**。
 */
test.describe('Admin Restore API', () => {
  test.describe.configure({ mode: 'serial' });

  test('バックアップから復元でき、取得時点の状態に戻る', async ({ page }) => {
    // ⚠️ 復元は DB を丸ごと入れ替える重い処理。既定の 60 秒では足りない
    // （pg_dump → pg_restore → 接続の切断と復帰）
    test.setTimeout(300_000);

    await signIn(page);
    await enterOrCreateWorkspace(page);

    // --- 1) 復元の基準点となるバックアップを取る
    const created = await graphqlQuery(
      page,
      'mutation { adminCreateBackup { id filename workspaceCount docCount } }'
    );

    test.skip(
      isPgToolUnavailable(created),
      'pg_dump が利用できない環境のためスキップ（postgresql-client を導入すると実行されます。docs/development.md 参照）'
    );

    const backupId = created.data?.adminCreateBackup?.id;
    expect(backupId).toBeTruthy();

    // #212: ⚠️ **目印を作る前に、バックアップの完了を待つこと。**
    // 作成は非同期なので、待たずに目印を作ると pg_dump より先に目印が入り、
    // **目印ごとバックアップされる**（復元しても消えず、何を検証しているか分からなくなる）。
    // ZIP も完了までは無い（ダウンロードが失敗する）
    expect(await waitForBackup(page, backupId)).toBe('completed');

    // --- 2) バックアップ後に「目印」を作る。復元すると消えるはず
    const marker = `restore-marker-${Date.now()}`;
    const madeAfter = await graphqlQuery(
      page,
      `mutation ($name: String) { createWorkspace(name: $name) { id } }`,
      { name: marker }
    );
    const markerWsId = madeAfter.data?.createWorkspace?.id;
    expect(markerWsId).toBeTruthy();

    // 目印が確かに存在すること（ポジティブコントロール）
    const before = await graphqlQuery(page, '{ workspaces { id name } }');
    expect(
      (before.data?.workspaces ?? []).some((w: any) => w.id === markerWsId)
    ).toBe(true);

    // --- 3) 復元する
    //
    // ⚠️ 復元は「保存済みバックアップのファイル」をアップロードする API。
    // 保存先から取り出して送り直す。
    const download = await page.request.get(
      `${BACKEND_URL}/api/admin/backups/${backupId}/download`
    );
    expect(download.ok()).toBe(true);
    const zip = await download.body();
    expect(zip.byteLength).toBeGreaterThan(0);

    const restored = await page.request.post(`${BACKEND_URL}/api/admin/restore`, {
      multipart: {
        file: {
          name: created.data.adminCreateBackup.filename ?? 'backup.zip',
          mimeType: 'application/zip',
          buffer: zip,
        },
      },
      timeout: 300_000,
    });
    if (!restored.ok()) {
      // 失敗時に原因が分かるようにする（本文にサーバーのメッセージが入る）
      throw new Error(
        `復元に失敗: ${restored.status()} ${await restored.text()}`,
      );
    }

    // --- 4) 目印が消えていること＝取得時点に戻ったこと
    //
    // ⚠️ 復元は全接続を切る（enterRestoreMode）ため、元のページは
    // SharedWorker ごと壊れた状態になる。**新しいページで確かめる。**
    await page.waitForTimeout(8_000);
    const verify = await page.context().newPage();
    await verify.goto('/');
    await verify.waitForLoadState('domcontentloaded');
    await verify.waitForTimeout(3_000);

    const after = await graphqlQuery(verify, '{ workspaces { id name } }');
    expect(after.errors).toBeUndefined();
    const names = (after.data?.workspaces ?? []).map((w: any) => w.name);
    expect(names).not.toContain(marker);

    // --- 5) ⚠️ **消えただけでは足りない。** 元のデータが生きていること
    const workspaces = after.data?.workspaces ?? [];
    expect(workspaces.length).toBeGreaterThan(0);

    // 復元後もドキュメントを引けること（本文が壊れていない）
    const owned = workspaces.find((w: any) => !w.id.startsWith('ffffffff-'));
    if (owned) {
      const docs = await graphqlQuery(
        verify,
        `query ($w: String!) { workspaceDocs(workspaceId: $w) { docId } }`,
        { w: owned.id }
      );
      expect(docs.errors).toBeUndefined();
    }
    await verify.close();
  });
});
