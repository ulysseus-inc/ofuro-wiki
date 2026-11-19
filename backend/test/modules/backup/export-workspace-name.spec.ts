import * as unzipper from 'unzipper';
import { BackupService } from '../../../src/modules/backup/backup.service';

/**
 * ⚠️ **書き出しの名前は、ワークスペースの中の名前（ルート文書）を使う。**
 *
 * DB の `workspaces.name` は作った時のまま（ほぼ `ofuro-wiki`）で変わらない。
 * それを使っていたため、「社内Wiki」を書き出すと `ofuro-wiki.ofuro-backup.zip` になり、
 * 取り込むと「ofuro-wiki (imported)」と名付けられていた
 * （v0.3.0 の手順書の確認で発覚・2026-11-11。docs/workspace-model.md 12.13）。
 */
describe('ワークスペースの書き出しの名前（12.13）', () => {
  const WS = 'ws-1';

  const make = (rootName: string | null) => {
    const prisma = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ id: WS, name: 'ofuro-wiki' }),
      },
      docMeta: { findMany: jest.fn().mockResolvedValue([]) },
      docSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      docUpdate: { groupBy: jest.fn().mockResolvedValue([]) },
      blob: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const names = {
      workspaceName: jest
        .fn()
        .mockImplementation((w: { name: string | null }) =>
          Promise.resolve(rootName ?? w.name),
        ),
    };
    const service = new BackupService(
      prisma as any,
      {} as any,
      {} as any,
      names as any,
    );
    return { service, names };
  };

  /** ZIP の中の manifest.json を読む */
  const readManifest = async (zip: Buffer) => {
    const dir = await unzipper.Open.buffer(zip);
    const entry = dir.files.find((f) => f.path === 'manifest.json');
    return JSON.parse((await entry!.buffer()).toString('utf8'));
  };

  test('【重要】ZIP の中の名前は、ルート文書の名前', async () => {
    const { service } = make('社内Wiki');

    const { zip } = await service.exportWorkspace(WS);

    expect((await readManifest(zip)).workspaceName).toBe('社内Wiki');
  });

  test('【重要】ファイル名に使う名前も、ルート文書の名前', async () => {
    const { service } = make('社内Wiki');

    const { name } = await service.exportWorkspace(WS);

    expect(name).toBe('社内Wiki');
  });

  test('ルート文書から読めなければ、DB の値を使う', async () => {
    const { service } = make(null);

    const { zip, name } = await service.exportWorkspace(WS);

    expect(name).toBe('ofuro-wiki');
    expect((await readManifest(zip)).workspaceName).toBe('ofuro-wiki');
  });
});
