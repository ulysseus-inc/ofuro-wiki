import { catchError, distinctUntilChanged, map, type Observable, of, startWith } from 'rxjs';

/**
 * #151 段階3: 台帳がキャッシュへ入ったかを表す流れを作る。
 *
 * ⚠️ **判定だけをここに置く**（副作用なし）。DI から切り離すことで、
 * 仕様の中核を単体で検証できる（`decide.ts` / `plan-meta-write.ts` と同じ方針）。
 *
 * ## ⚠️ エラーで止めないこと
 *
 * この流れは「ページを開いてよいか」の関門に合流する（7.5.5）。
 * エラーで終了させると `combineLatest` ごと死に、**画面が二度と出ない**。
 *
 * 取得に失敗した場合も**準備完了として扱う**。待ち続けると
 * オフラインで画面が永久に出ないため。手元にキャッシュがあればそれを使い、
 * 無ければ空の一覧になる（判断は `decideDiscoverySource` に委ねる）。
 */
export function ledgerReady$(source$: Observable<unknown>): Observable<boolean> {
  return source$.pipe(
    map(() => true),
    // ⚠️ **エラーでも true にする。** false にすると画面が出ないまま止まる
    catchError(() => of(true)),
    startWith(false),
    distinctUntilChanged()
  );
}
