import { describe, expect, test } from 'vitest';

import { decideDiscoverySource } from '../decide';
import type { DiscoveryCacheEntry } from '../stores/discovery-cache';

/**
 * #151: **いつキャッシュを使ってよいか。**
 *
 * > ⚠️ キャッシュは権限情報の正本ではない。認可済み Snapshot の一時的な複製である。
 * > **TTL によって権限失効を遅延させてはならない。**
 *
 * ここが崩れると「権限を外したのに一覧に残る」ことになる。
 */
describe('Discovery Index をいつ信用するか', () => {
  const cached = (revision: string, fetchedAt = '2026-01-01T00:00:00.000Z') =>
    ({
      workspaceId: 'ws-1',
      userId: 'user-1',
      revision,
      fetchedAt,
      documents: [],
    }) satisfies DiscoveryCacheEntry;

  test('版数が一致すればキャッシュを使う', () => {
    expect(
      decideDiscoverySource({ cached: cached('5'), serverRevision: '5' })
    ).toBe('use-cache');
  });

  /**
   * ⚠️ **これが本命。** 権限が変われば版数が上がるため、
   * キャッシュがどれだけ新しくても信用しない。
   */
  test('版数が違えば取り直す（取得直後のキャッシュでも）', () => {
    expect(
      decideDiscoverySource({
        cached: cached('5', new Date().toISOString()),
        serverRevision: '6',
      })
    ).toBe('fetch');
  });

  /** ⚠️ 時間で判断しない。古くても版数が同じなら使ってよい。 */
  test('古いキャッシュでも版数が同じなら使う', () => {
    expect(
      decideDiscoverySource({
        cached: cached('5', '2020-01-01T00:00:00.000Z'),
        serverRevision: '5',
      })
    ).toBe('use-cache');
  });

  test('キャッシュが無ければ取りに行く', () => {
    expect(
      decideDiscoverySource({ cached: undefined, serverRevision: '5' })
    ).toBe('fetch');
  });

  /**
   * ⚠️ **オフラインは例外として許容する。**
   * 一覧を全部隠すと Wiki として使い物にならないため。
   * 復帰時には必ず版数を検証する。
   */
  test('サーバーに繋がらなければ最後の Snapshot を使う', () => {
    expect(
      decideDiscoverySource({ cached: cached('5'), serverRevision: null })
    ).toBe('use-offline-cache');
  });

  /** ⚠️ 黙って空の一覧を見せない（ページが消えたように見える）。 */
  test('繋がらず手元にも無ければ失敗させる', () => {
    expect(
      decideDiscoverySource({
        cached: undefined,
        serverRevision: null,
        failure: 'unreachable',
      })
    ).toBe('fail');
  });

  /**
   * ⚠️ **「繋がらない」と「拒否された」を混ぜてはいけない。**
   *
   * 権限を剥奪されると `discoveryRevision` は**拒否**される。これを
   * オフラインと同じに扱うと、**オンラインなのに古い一覧を見せ続ける**。
   * この仕組みが守ろうとしている性質そのものを破ることになる。
   */
  describe('拒否とオフラインの区別', () => {
    test('拒否されたらキャッシュがあっても使わない', () => {
      expect(
        decideDiscoverySource({
          cached: cached('5'),
          serverRevision: null,
          failure: 'rejected',
        })
      ).toBe('fail');
    });

    test('繋がらないだけならキャッシュを使う（同じ入力でも判定が逆）', () => {
      expect(
        decideDiscoverySource({
          cached: cached('5'),
          serverRevision: null,
          failure: 'unreachable',
        })
      ).toBe('use-offline-cache');
    });

    /** 理由が分からない場合は、従来どおりオフライン扱い（後方互換）。 */
    test('理由が無ければオフライン扱い', () => {
      expect(
        decideDiscoverySource({ cached: cached('5'), serverRevision: null })
      ).toBe('use-offline-cache');
    });
  });
});
