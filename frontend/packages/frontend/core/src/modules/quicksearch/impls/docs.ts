import { ServerFeature } from '@ofuro/graphql';
import {
  effect,
  Entity,
  LiveData,
  onComplete,
  onStart,
} from '@toeverything/infra';
import { truncate } from 'lodash-es';
import { catchError, EMPTY, map, of, switchMap, tap, throttleTime } from 'rxjs';

import type { WorkspaceServerService } from '../../cloud';
import type { DocRecord, DocsService } from '../../doc';
import type { DocDisplayMetaService } from '../../doc-display-meta';
import type { DocsSearchService } from '../../docs-search';
import type { WorkspaceService } from '../../workspace';
import type { QuickSearchSession } from '../providers/quick-search-provider';
import type { QuickSearchItem } from '../types/item';

interface DocsPayload {
  docId: string;
  title?: string;
  blockId?: string | undefined;
  blockContent?: string | undefined;
}

export class DocsQuickSearchSession
  extends Entity
  implements QuickSearchSession<'docs', DocsPayload>
{
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceServerService: WorkspaceServerService,
    private readonly docsSearchService: DocsSearchService,
    private readonly docsService: DocsService,
    private readonly docDisplayMetaService: DocDisplayMetaService
  ) {
    super();
  }

  private readonly isSupportServerIndexer = () =>
    this.workspaceServerService.server?.config$.value.features.includes(
      ServerFeature.Indexer
    ) ?? false;

  private readonly isIndexerLoading$ = this.docsSearchService.indexerState$.map(
    ({ completed }) => {
      return !completed;
    }
  );

  private readonly isQueryLoading$ = new LiveData(false);

  isCloudWorkspace = this.workspaceService.workspace.flavour !== 'local';

  isLoading$ = LiveData.computed(get => {
    return (
      (this.isCloudWorkspace ? false : get(this.isIndexerLoading$)) ||
      get(this.isQueryLoading$)
    );
  });

  error$ = new LiveData<any>(null);

  items$ = new LiveData<QuickSearchItem<'docs', DocsPayload>[]>([]);

  searchLocally = !this.isCloudWorkspace;

  query = effect(
    throttleTime<string>(500, undefined, {
      leading: false,
      trailing: true,
    }),
    switchMap((query: string) => {
      let out;
      if (!query) {
        out = of([]);
      } else {
        const preferRemote =
          !this.searchLocally && this.isSupportServerIndexer();
        const preferMode =
          this.searchLocally || !this.isSupportServerIndexer()
            ? 'local'
            : 'remote';
        const search$ = preferRemote
          ? this.docsSearchService.search$(query, 'remote').pipe(
              // 0 件・エラーのときはブラウザの索引で探し直す（docs/quick-search.md 2 章）
              switchMap(docs => {
                if (docs.length > 0) {
                  return of(docs);
                }
                return this.docsSearchService.search$(query, 'local');
              }),
              catchError(() => this.docsSearchService.search$(query, 'local'))
            )
          : this.docsSearchService.search$(query, preferMode);

        out = search$.pipe(
          map(docs =>
            docs
              .map(doc => {
                const docRecord = this.docsService.list.doc$(doc.docId).value;
                return [doc, docRecord] as const;
              })
              .filter(
                (props): props is [(typeof props)[0], DocRecord] => !!props[1]
              )
              .map(([doc, docRecord]) => {
                const { title, icon, updatedDate } =
                  this.docDisplayMetaService.getDocDisplayMeta(docRecord);
                return {
                  id: 'doc:' + docRecord.id,
                  source: 'docs',
                  group: {
                    id: 'docs',
                    label: {
                      i18nKey: 'com.affine.quicksearch.group.searchfor',
                      options: { query: truncate(query) },
                    },
                    score: 5,
                  },
                  label: {
                    title: title,
                    subTitle: doc.blockContent,
                  },
                  score: doc.score,
                  icon,
                  timestamp: updatedDate,
                  payload: doc,
                } as QuickSearchItem<'docs', DocsPayload>;
              })
          )
        );
      }
      return out.pipe(
        tap(items => {
          this.items$.next(items);
          this.isQueryLoading$.next(false);
        }),
        onStart(() => {
          this.error$.next(null);
          this.items$.next([]);
          this.isQueryLoading$.next(true);
        }),
        catchError(err => {
          this.error$.next(err instanceof Error ? err.message : err);
          this.items$.next([]);
          this.isQueryLoading$.next(false);
          return EMPTY;
        }),
        onComplete(() => {})
      );
    })
  );

  // TODO(@EYHN): load more

  override dispose(): void {
    this.query.unsubscribe();
  }
}
