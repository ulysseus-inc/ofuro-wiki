import { describe, expect, test } from 'vitest';

import { isEntryFor } from '../cache-identity';

/**
 * #151: キャッシュの本人確認。
 *
 * ⚠️ **鍵が一致しても、中身の保証にはならない。**
 * 別タブが書いた中身が別人のものだった場合、確かめずに取り込むと
 * **他人の一覧を見せてしまう**。
 */
describe('#151 キャッシュの本人確認', () => {
  const entry = { workspaceId: 'ws', userId: 'u1', documents: [] };

  test('本人・同じワークスペースなら通す', () => {
    expect(isEntryFor(entry, 'ws', 'u1')).toBe(true);
  });

  /** ⚠️ 共用 PC で前の利用者の一覧を見せない */
  test('⚠️ 別の利用者の中身は弾く', () => {
    expect(isEntryFor(entry, 'ws', 'u2')).toBe(false);
  });

  /** ⚠️ 参加していないワークスペースの一覧を見せない */
  test('⚠️ 別のワークスペースの中身は弾く', () => {
    expect(isEntryFor(entry, 'ws2', 'u1')).toBe(false);
  });

  test('中身が無ければ弾く', () => {
    expect(isEntryFor(undefined, 'ws', 'u1')).toBe(false);
  });
});
