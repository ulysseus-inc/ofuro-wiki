import { concat, firstValueFrom, of, throwError, toArray } from 'rxjs';
import { describe, expect, test } from 'vitest';

import { ledgerReady$ } from '../ledger-ready';

/**
 * #151 段階3: **台帳を取り終えたか**を表す流れ。
 *
 * ⚠️ 7.5.5 が言う「台帳がキャッシュへ入った」ではない。
 * いまキャッシュを投入しているのは Yjs 目次であり、台帳ではない。
 * ここが待つ目的は**版数を先に受け取ること**（取る前に書くと、
 * 移行済みのページで必ず stale になり台帳へ届かない）。
 *
 * ⚠️ この流れは「ページを開いてよいか」の関門に合流する。
 * **エラーで終了させると画面が二度と出ない。**
 */
describe('#151 段階3 台帳の準備完了', () => {
  const collect = (source: Parameters<typeof ledgerReady$>[0]) =>
    firstValueFrom(ledgerReady$(source).pipe(toArray()));

  test('最初は未完了、値が来たら完了になる', async () => {
    expect(await collect(of(['doc']))).toEqual([false, true]);
  });

  /**
   * ⚠️ **0件でも完了とみなすこと。**
   * 「ドキュメントが1件も無いワークスペース」は正常な状態であり、
   * 未完了として待ち続けてはいけない。
   */
  test('⚠️ 0件でも完了になる', async () => {
    expect(await collect(of([]))).toEqual([false, true]);
  });

  /**
   * ⚠️ **これが最も重要。**
   *
   * エラーで終了させると `combineLatest` ごと死に、
   * **一覧が準備完了にならず画面が永久に出ない**。
   * 取得に失敗しても完了として扱い、画面は出す
   * （何を見せるかは `decideDiscoverySource` が判断する）。
   */
  test('⚠️ エラーでも完了になる（画面を止めない）', async () => {
    const source = throwError(() => new Error('通信できません'));
    expect(await collect(source)).toEqual([false, true]);
  });

  /**
   * ⚠️ **「何か流れてきた」を完了とみなさないこと。**
   *
   * 起動直後は認証の復元前に account が null になり（LiveData の初期値）、
   * 一覧に空配列が1回流れる。それを完了とすると、
   * **版数を受け取る前に書き込めてしまい、移行済みのページで必ず stale になる**。
   *
   * そのため `ledgerReady$` には「取得が決着した」ことだけを流す
   * （`docs.ts` は `ledgerSettled$$` を `filter(Boolean)` して渡している）。
   */
  test('⚠️ false は完了として扱わない（決着だけを待つ）', async () => {
    const { concat, of: rxOf } = await import('rxjs');
    // 決着前の false が混ざっても、完了になるのは true が来てから
    const source = concat(rxOf(false), rxOf(false)).pipe();
    const settled$ = source.pipe(
      // docs.ts と同じ絞り込み
      (await import('rxjs')).filter(Boolean)
    );
    expect(await collect(settled$)).toEqual([false]);
  });

  test('値が続いても、完了は一度だけ流す', async () => {
    expect(await collect(concat(of([]), of([]), of([])))).toEqual([false, true]);
  });
});
