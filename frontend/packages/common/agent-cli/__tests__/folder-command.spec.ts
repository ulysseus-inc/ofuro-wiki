/**
 * #274: folder コマンドの引数・前提の検査（#284 レビュー）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseArgs } from '../src/commands/args';
import { folder } from '../src/commands/folders';
import type { Session } from '../src/domain/session';

describe('folder add（#284 レビュー）', () => {
  it('⚠️ ゴミ箱のページは入れない（入れても folders に出ず、入ったか分からない）', async () => {
    const space = {
      id: 'ws',
      ledger: {
        find: () => Promise.resolve({ id: 'd1', title: '題', trash: true }),
      },
    };
    const session = {
      resolveDoc: () => Promise.resolve({ space, docId: 'd1' }),
      syncFor: () => assert.fail('ゴミ箱の確認より先にフォルダを開いた'),
    } as unknown as Session;

    await assert.rejects(
      folder(session, parseArgs(['add', '設計', 'd1'])),
      /ゴミ箱にあるページ/
    );
  });
});
