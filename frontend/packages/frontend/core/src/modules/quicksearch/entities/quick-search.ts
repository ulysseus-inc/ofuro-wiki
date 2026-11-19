import { Entity, LiveData } from '@toeverything/infra';
import { mean } from 'lodash-es';

import type {
  QuickSearchSession,
  QuickSearchSource,
  QuickSearchSourceItemType,
} from '../providers/quick-search-provider';
import type { QuickSearchItem } from '../types/item';
import type { QuickSearchOptions } from '../types/options';

export class QuickSearch extends Entity {
  constructor() {
    super();
  }
  private readonly state$ = new LiveData<{
    query: string;
    sessions: QuickSearchSession<any, any>[];
    options: QuickSearchOptions;
    callback: (result: QuickSearchItem | null) => void;
  } | null>(null);

  readonly items$ = this.state$
    .map(s => s?.sessions.map(session => session.items$) ?? [])
    .flat()
    .map(items => items.flat());

  readonly error$ = this.state$
    .map(s => s?.sessions.map(session => session.error$) ?? [])
    .flat()
    .map(items => items.find(v => !!v) ?? null);

  readonly show$ = this.state$.map(s => !!s);

  readonly options$ = this.state$.map(s => s?.options);

  readonly isLoading$ = this.state$
    .map(
      s =>
        s?.sessions.map(session => session.isLoading$ ?? new LiveData(false)) ??
        []
    )
    .flat()
    .map(items => items.reduce((acc, item) => acc || item, false));

  readonly loadingProgress$ = this.state$
    .map(
      s =>
        s?.sessions.map(
          session =>
            (session.loadingProgress$ ?? new LiveData(null)) as LiveData<
              number | null
            >
        ) ?? []
    )
    .flat()
    .map(items => mean(items.filter((v): v is number => v === null)));

  show = <const Sources extends any[]>(
    sources: Sources,
    cb: (result: QuickSearchSourceItemType<Sources[number]> | null) => void,
    options: QuickSearchOptions = {}
  ) => {
    if (this.state$.value) {
      this.hide();
    }

    // #321: 閉じきる前に開き直したら、積んだコマンドは捨てる（docs/quick-search.md 3 章）
    this.afterClosed = [];

    const sessions = sources.map((source: QuickSearchSource<any, any>) => {
      if (typeof source === 'function') {
        const items$ = new LiveData<QuickSearchItem<any, any>[]>([]);
        return {
          items$,
          query: (query: string) => {
            items$.next(source(query));
          },
        } as QuickSearchSession<any, any>;
      } else {
        return source as QuickSearchSession<any, any>;
      }
    });
    sessions.forEach(session => {
      session.query?.(options.defaultQuery || '');
    });
    this.state$.next({
      query: options.defaultQuery ?? '',
      options,
      sessions: sessions,
      callback: cb as any,
    });
  };

  query$ = this.state$.map(s => s?.query || '');

  setQuery = (query: string) => {
    if (!this.state$.value) return;
    this.state$.next({
      ...this.state$.value,
      query,
    });
    this.state$.value.sessions.forEach(session => session.query?.(query));
  };

  hide() {
    if (this.state$.value) {
      this.state$.value.sessions.forEach(session => session.dispose?.());
      this.state$.value.callback?.(null);
    }

    this.state$.next(null);
  }

  // #321: 窓が閉じきってから動かす処理（docs/quick-search.md 3 章）
  // 選んだ時点（submit の callback）で積む。その直後に閉じ始めるので、必ず動く
  private afterClosed: Array<() => void> = [];

  runAfterClosed(fn: () => void) {
    this.afterClosed.push(fn);
  }

  /** 窓が閉じきったとき、画面から呼ぶ */
  notifyClosed() {
    const fns = this.afterClosed;
    this.afterClosed = [];
    fns.forEach(fn => fn());
  }

  submit(result: QuickSearchItem | null) {
    if (result && result.beforeSubmit && !result.beforeSubmit?.()) {
      return;
    }
    if (this.state$.value?.callback) {
      this.state$.value.sessions.forEach(session => session.dispose?.());
      this.state$.value.callback(result);
    }
    this.state$.next(null);
  }
}
