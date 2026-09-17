import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';

import { classifyFailure } from '../decide';
import { OBSERVED_FAILURES } from './fixtures/observed-failures';

/**
 * #151: **版数を取れなかった理由の見分け。**
 *
 * ⚠️ **どちらに寄せても害が出る。**
 *
 * | 誤り | 起きること |
 * |---|---|
 * | 拒否をオフライン扱い | **権限を剥奪されてもキャッシュを見せ続ける** |
 * | 障害を拒否扱い | **一時的な障害でキャッシュを消し、一覧が消える** |
 *
 * ⚠️ **推測で書かない。** 実測せずに実装したため、
 * 「GraphQL の認可拒否は HTTP 200 で返る」ことに気づかず、
 * **HTTP status で判定して何も判定できていない**修正を入れた
 * （レビュー5巡目で発覚）。
 *
 * ここは `fixtures/observed-failures.ts` の**実測値**を総当たりする。
 */
describe('版数を取れなかった理由の見分け（実測の総当たり）', () => {
  /** `fetcher.ts` が投げる形を、実測値から組み立てる。 */
  const asThrown = (f: (typeof OBSERVED_FAILURES)[number]) => {
    if (f.thrownType === 'TypeError') return new TypeError('fetch failed');
    const extensions: Record<string, unknown> = { status: f.http };
    if (f.code) extensions.code = f.code;
    return Object.assign(new Error(f.scene), { extensions });
  };

  test.each(OBSERVED_FAILURES.map(f => [f.scene, f] as const))(
    '%s',
    (_scene, f) => {
      // `invalid`（応答が壊れている）は classifyFailure の担当外
      if (f.expected === 'invalid') return;
      expect(classifyFailure(asThrown(f))).toBe(f.expected);
    }
  );

  /** ⚠️ 表が空になっていたら、検査が空振りしている。 */
  test('実測が十分な数ある', () => {
    expect(OBSERVED_FAILURES.length).toBeGreaterThanOrEqual(6);
    // 両方向が含まれていること（片方だけだと倒れに気づけない）
    expect(OBSERVED_FAILURES.some(f => f.expected === 'rejected')).toBe(true);
    expect(OBSERVED_FAILURES.some(f => f.expected === 'unreachable')).toBe(true);
  });

  /**
   * ⚠️ **判断がつかないものは、キャッシュを残す側へ倒す。**
   * 消す側へ倒すと、想定外の応答で一覧が消える。
   */
  test.each([undefined, null, 'error', {}, new Error('unknown')])(
    '判断できないもの（%s）はキャッシュを残す側',
    value => {
      expect(classifyFailure(value)).toBe('unreachable');
    }
  );
});

/**
 * ⚠️ **`fetcher.ts` が判定材料を載せていること。**
 *
 * 載せるのをやめても、作り物のエラーで検査していると気づけない
 * （本日実際に見逃した）。**実装を読んで確かめる。**
 */
describe('GraphQL エラーが判定材料を持っている', () => {
  const fetcher = fs.readFileSync(
    path.join(__dirname, '../../../../../../common/graphql/src/fetcher.ts'),
    'utf-8'
  );

  test.each([
    ['errors 本文がある経路', 'const firstError = result.errors[0]'],
    ['errors 本文が無い経路', "'Empty GraphQL error body'"],
    ['JSON ですらない経路', 'responds unexpected result'],
  ])('%s に status が載っている', (_name, anchor) => {
    const idx = fetcher.indexOf(anchor);
    expect(idx).toBeGreaterThan(-1);
    // ⚠️ errors 経路は `?? res.status`（サーバーの値を優先）のため、
    // 文字どおりの一致では見ない
    expect(fetcher.slice(idx, idx + 700)).toContain('res.status');
  });

  /** ⚠️ code は GraphQL の応答由来。潰していないこと。 */
  test('errors 経路で code を残している', () => {
    const idx = fetcher.indexOf('const firstError = result.errors[0]');
    expect(fetcher.slice(idx, idx + 700)).toContain('...firstError.extensions');
  });

  /**
   * ⚠️ **サーバーが載せた status を潰さないこと。**
   *
   * GraphQL エラーは HTTP 200 で返るため、`res.status` で上書きすると
   * サーバーが載せた 429 等が 200 になる。
   * `sign-in-with-password.tsx` は `error?.status === 429` で
   * レート制限を判定しており、**既存機能が静かに壊れる**。
   */
  test('サーバーが載せた status を上書きしない', () => {
    const idx = fetcher.indexOf('const firstError = result.errors[0]');
    const block = fetcher.slice(idx, idx + 700);
    expect(block).toMatch(/extensions\s*as\s*any\)\?\.status\s*\?\?\s*res\.status/);
  });

  /**
   * ⚠️ **実物を採取して分かった形**（2026-08-25）。
   *
   * バックエンドは `extensions.code = "FORBIDDEN"` を返すが、
   * アプリが実際に投げるのは `UserFriendlyError` で、これは
   * `GraphQLError.extensions` を**展開して**作られるため
   * **`extensions` を持たず `code` を直接持つ**。
   *
   * `extensions` だけを見ていたため、**権限拒否が一度も検出されず、
   * 通らない要求を延々と再送し続けていた**。
   */
  describe('UserFriendlyError の形（実測）', () => {
    /** 非メンバーが setDocTitle を叩いたときの実際の応答から起こした形 */
    const userFriendlyForbidden = Object.assign(
      new Error('Access denied to this workspace'),
      { code: 'FORBIDDEN', status: undefined, name: 'FORBIDDEN' }
    );

    test('⚠️ extensions が無くても FORBIDDEN を検出する', () => {
      expect(classifyFailure(userFriendlyForbidden)).toBe('rejected');
    });

    test('⚠️ 直接 status を持つ形でも検出する', () => {
      expect(classifyFailure({ status: 403 })).toBe('rejected');
      expect(classifyFailure({ status: 401 })).toBe('rejected');
    });

    /** バックエンドの応答は originalError にも 403 を持つ */
    test('originalError の statusCode でも検出する', () => {
      expect(
        classifyFailure({
          extensions: { originalError: { statusCode: 403 } },
        })
      ).toBe('rejected');
    });

    /** ⚠️ 通信断を拒否と取り違えないこと */
    test('⚠️ 通信断は拒否ではない', () => {
      expect(classifyFailure(new Error('Failed to fetch'))).toBe('unreachable');
      expect(classifyFailure({ code: 'NETWORK_ERROR' })).toBe('unreachable');
      expect(classifyFailure({ status: 500 })).toBe('unreachable');
    });
  });

  /**
   * ⚠️ **候補を `??` でつながないこと。**
   * 手前に認可と無関係な値が入っていると、そこで止まって
   * **後ろの 403 に辿り着けず、拒否を通信失敗と取り違えて延々と再送する**。
   */
  describe('status の候補が複数ある場合', () => {
    test('⚠️ 手前に 200 があっても、奥の 403 を見つける', () => {
      expect(
        classifyFailure({
          extensions: { status: 200, originalError: { statusCode: 403 } },
        })
      ).toBe('rejected');
    });

    test('⚠️ 手前に 500 があっても、奥の 401 を見つける', () => {
      expect(
        classifyFailure({
          status: 500,
          extensions: { originalError: { statusCode: 401 } },
        })
      ).toBe('rejected');
    });

    test('どれも認可拒否でなければ通信失敗として扱う', () => {
      expect(
        classifyFailure({
          status: 500,
          extensions: { status: 502, originalError: { statusCode: 503 } },
        })
      ).toBe('unreachable');
    });
  });
});
