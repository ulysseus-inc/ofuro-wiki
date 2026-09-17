import { omit } from 'lodash-es';
import {
  filter,
  first,
  lastValueFrom,
  Observable,
  ReplaySubject,
  share,
  Subject,
  switchMap,
  throttleTime,
} from 'rxjs';
import { applyUpdate, Doc as YDoc } from 'yjs';

import {
  type AggregateOptions,
  type AggregateResult,
  type DocStorage,
  IndexerDocument,
  type IndexerSchema,
  type IndexerStorage,
  type Query,
  type SearchOptions,
  type SearchResult,
} from '../../storage';
import { DummyIndexerStorage } from '../../storage/dummy/indexer';
import type { IndexerSyncStorage } from '../../storage/indexer-sync';
import { AsyncPriorityQueue } from '../../utils/async-priority-queue';
import { fromPromise } from '../../utils/from-promise';
import { takeUntilAbort } from '../../utils/take-until-abort';
import { MANUALLY_STOP, throwIfAborted } from '../../utils/throw-if-aborted';
import type { PeerStorageOptions } from '../types';
import { crawlingDocData } from './crawler';

export type IndexerPreferOptions = 'local' | 'remote';

export interface IndexerSyncState {
  paused: boolean;
  batterySaveMode: boolean;
  /**
   * Number of documents currently in the indexing queue
   */
  indexing: number;
  /**
   * Indicates whether all documents have been successfully indexed
   *
   * This is only for UI display purposes. For logical operations, please use `waitForCompleted()`
   */
  completed: boolean;
  /**
   * Total number of documents in the workspace
   */
  total: number;
  errorMessage: string | null;
}

export interface IndexerDocSyncState {
  /**
   * Indicates whether this document is currently in the indexing queue
   */
  indexing: boolean;
  /**
   * Indicates whether this document has been successfully indexed
   *
   * This is only for UI display purposes. For logical operations, please use `waitForDocCompleted()`
   */
  completed: boolean;
}

export interface IndexerSync {
  state$: Observable<IndexerSyncState>;
  docState$(docId: string): Observable<IndexerDocSyncState>;
  addPriority(docId: string, priority: number): () => void;
  /**
   * #199: 索引すべきページの一覧を渡す（認可済み台帳から）。
   * ⚠️ 渡すまで索引は始まらない。docs/client-indexer.md
   */
  setDocList(docs: Array<{ docId: string; title?: string }>): void;
  waitForCompleted(signal?: AbortSignal): Promise<void>;
  waitForDocCompleted(docId: string, signal?: AbortSignal): Promise<void>;

  search<T extends keyof IndexerSchema, const O extends SearchOptions<T>>(
    table: T,
    query: Query<T>,
    options?: O & { prefer?: IndexerPreferOptions }
  ): Promise<SearchResult<T, O>>;

  aggregate<T extends keyof IndexerSchema, const O extends AggregateOptions<T>>(
    table: T,
    query: Query<T>,
    field: keyof IndexerSchema[T],
    options?: O & { prefer?: IndexerPreferOptions }
  ): Promise<AggregateResult<T, O>>;

  search$<T extends keyof IndexerSchema, const O extends SearchOptions<T>>(
    table: T,
    query: Query<T>,
    options?: O & { prefer?: IndexerPreferOptions }
  ): Observable<SearchResult<T, O>>;

  aggregate$<
    T extends keyof IndexerSchema,
    const O extends AggregateOptions<T>,
  >(
    table: T,
    query: Query<T>,
    field: keyof IndexerSchema[T],
    options?: O & { prefer?: IndexerPreferOptions }
  ): Observable<AggregateResult<T, O>>;
}

export class IndexerSyncImpl implements IndexerSync {
  private abort: AbortController | null = null;
  private readonly rootDocId = this.doc.spaceId;
  private readonly status = new IndexerSyncStatus(this.rootDocId);

  private readonly indexer: IndexerStorage;
  private readonly remote?: IndexerStorage;

  private lastRefreshed = Date.now();

  /**
   * #199: **索引すべきページの一覧（認可済み台帳から渡される）。**
   *
   * ⚠️ `null` のあいだは**何も索引しない**。共有目次へ後戻りしてはいけない。
   * 段階3 で目次を空にしたため、目次を見ると索引が0件になる。
   *
   * ⚠️ `status.reset()` は再試行のたびに一覧を消すので、**ここで保持する**。
   *
   * 詳細は docs/client-indexer.md
   */
  private authorizedDocs: Map<string, { title: string | undefined }> | null = null;
  /** 一覧が届くのを待っている者を起こす */
  private docListArrived: (() => void) | null = null;

  /**
   * #199: 索引すべきページの一覧を渡す（主スレッドから）。
   *
   * ⚠️ **認可の判断はここでしない。** 渡された一覧をそのまま信じる。
   * 誰が読めるかを決めるのはサーバー（`discoverySnapshot`）。
   */
  setDocList(docs: Array<{ docId: string; title?: string }>) {
    this.authorizedDocs = new Map(docs.map(d => [d.docId, { title: d.title }]));
    this.applyDocList();
    this.docListArrived?.();
  }

  /**
   * 一覧を索引の基準へ反映する。
   *
   * ⚠️ **`docsInRootDoc` を差し替えるだけにする。** 追加も削除も既に
   * この変数を基準に動いているので、差し替えれば**両方が同時に**台帳基準になる。
   * 削除側を書き換えると、片方だけ直したときに
   * **権限を剥奪したページが索引に residue として残る**。
   */
  private applyDocList() {
    const docs = this.authorizedDocs;
    if (!docs || !this.status.rootDocReady) {
      return;
    }

    const previous = this.status.docsInRootDoc;
    this.status.docsInRootDoc = new Map(docs);

    // ⚠️ **変わったものだけ積む。** 一覧は台帳を取り直すたびに届き、
    // 取り直しは誰かが題を打つたびに起きる。毎回すべて積むと、
    // **ページ数 × 接続人数**の空振りが題の打鍵ごとに走る
    for (const [docId, { title }] of docs) {
      const before = previous.get(docId);
      if (before && before.title === title) {
        continue;
      }
      this.status.scheduleJob(docId);
    }

    // ⚠️ ルート文書の job が「追加と削除の突き合わせ」を行う。積み忘れると
    // 一覧から消えたページが索引に残る（＝剥奪されたページが検索に出る）
    this.status.scheduleJob(this.rootDocId);
    this.status.statusUpdatedSubject$.next(true);
  }

  /** 一覧が届くまで待つ。⚠️ 届くまで索引を始めない */
  private async waitForDocList(signal?: AbortSignal) {
    if (this.authorizedDocs) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.docListArrived = () => {
        this.docListArrived = null;
        resolve();
      };
      signal?.addEventListener('abort', () => reject(signal.reason));
    });
  }

  state$ = this.status.state$.pipe(
    // throttle the state to 1 second to avoid spamming the UI
    throttleTime(1000, undefined, {
      leading: true,
      trailing: true,
    })
  );
  docState$(docId: string) {
    return this.status.docState$(docId).pipe(
      // throttle the state to 1 second to avoid spamming the UI
      throttleTime(1000, undefined, { leading: true, trailing: true })
    );
  }

  async waitForCompleted(signal?: AbortSignal) {
    await lastValueFrom(
      this.status.state$.pipe(
        filter(state => state.completed),
        takeUntilAbort(signal),
        first()
      )
    );
  }

  async waitForDocCompleted(docId: string, signal?: AbortSignal) {
    await lastValueFrom(
      this.status.docState$(docId).pipe(
        filter(state => state.completed),
        takeUntilAbort(signal),
        first()
      )
    );
  }

  constructor(
    readonly doc: DocStorage,
    readonly peers: PeerStorageOptions<IndexerStorage>,
    readonly indexerSync: IndexerSyncStorage
  ) {
    // sync feature only works on local indexer
    this.indexer = this.peers.local;
    this.remote = Object.values(this.peers.remotes).find(remote => !!remote);
  }

  enableBatterySaveMode() {
    this.status.enableBatterySaveMode();
  }

  disableBatterySaveMode() {
    this.status.disableBatterySaveMode();
  }

  pauseSync() {
    this.status.pauseSync();
  }

  resumeSync() {
    this.status.resumeSync();
  }

  start() {
    if (this.abort) {
      this.abort.abort(MANUALLY_STOP);
    }

    const abort = new AbortController();
    this.abort = abort;

    this.mainLoop(abort.signal).catch(error => {
      if (error === MANUALLY_STOP) {
        return;
      }
      console.error('index error', error);
    });
  }

  stop() {
    this.abort?.abort(MANUALLY_STOP);
    this.abort = null;
  }

  addPriority(id: string, priority: number) {
    return this.status.addPriority(id, priority);
  }

  private async mainLoop(signal?: AbortSignal) {
    if (this.indexer.isReadonly) {
      this.status.isReadonly = true;
      this.status.statusUpdatedSubject$.next(true);
      return;
    }

    while (true) {
      try {
        await this.retryLoop(signal);
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        console.error('index error, retry in 5s', error);
        this.status.errorMessage =
          error instanceof Error ? error.message : `${error}`;
        this.status.statusUpdatedSubject$.next(true);
      } finally {
        // reset all status
        this.status.reset();
        // wait for 5s before next retry
        await Promise.race([
          new Promise<void>(resolve => {
            setTimeout(resolve, 5000);
          }),
          new Promise((_, reject) => {
            // exit if manually stopped
            if (signal?.aborted) {
              reject(signal.reason);
            }
            signal?.addEventListener('abort', () => {
              reject(signal.reason);
            });
          }),
        ]);
      }
    }
  }

  private async retryLoop(signal?: AbortSignal) {
    await Promise.race([
      Promise.all([
        this.doc.connection.waitForConnected(signal),
        this.indexer.connection.waitForConnected(signal),
        this.indexerSync.connection.waitForConnected(signal),
      ]),
      new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Connect to remote timeout'));
        }, 1000 * 30);
      }),
      new Promise((_, reject) => {
        signal?.addEventListener('abort', reason => {
          reject(reason);
        });
      }),
    ]);

    this.status.errorMessage = null;
    this.status.statusUpdatedSubject$.next(true);

    const indexVersion = await this.indexer.indexVersion();
    console.log('indexer sync start, version: ', indexVersion);

    const unsubscribe = this.doc.subscribeDocUpdate(update => {
      if (!this.status.rootDocReady) {
        return;
      }
      if (update.docId === this.rootDocId) {
        // ⚠️ 本文の取り込みは続ける（参照の解決に `status.rootDoc` を使う）。
        // #199: **一覧はここから作らない。** 共有目次は段階3 で空になっており、
        // 見に行くと索引の対象が0件になる。一覧は `setDocList` から来る
        applyUpdate(this.status.rootDoc, update.bin);
      } else {
        const docId = update.docId;
        const existingDoc = this.status.docsInRootDoc.get(docId);
        if (existingDoc) {
          this.status.scheduleJob(docId);
        }
      }
    });

    try {
      const rootDocBin = (await this.doc.getDoc(this.rootDocId))?.bin;
      if (rootDocBin) {
        applyUpdate(this.status.rootDoc, rootDocBin);
      }

      // #199: ⚠️ **索引の対象は共有目次ではなく、渡される一覧（認可済み台帳）。**
      // 段階3 で目次を空にしたため、目次を見ると索引が0件になる。
      // 一覧が届くまで索引を始めない（docs/client-indexer.md 5章）
      await this.waitForDocList(signal);

      this.status.rootDocReady = true;
      this.applyDocList();
      this.status.statusUpdatedSubject$.next(true);

      const allIndexedDocs = await this.getAllDocsFromIndexer();
      this.status.docsInIndexer = allIndexedDocs;
      this.status.statusUpdatedSubject$.next(true);

      while (true) {
        throwIfAborted(signal);

        const docId = await this.status.acceptJob(signal);

        if (docId === this.rootDocId) {
          console.log('[indexer] start indexing root doc', docId);
          // #region crawl root doc
          for (const [docId, { title }] of this.status.docsInRootDoc) {
            const existingDoc = this.status.docsInIndexer.get(docId);
            if (existingDoc) {
              if (existingDoc.title !== title) {
                // need update
                await this.indexer.update(
                  'doc',
                  IndexerDocument.from(docId, {
                    docId,
                    title,
                  })
                );
                this.status.docsInIndexer.set(docId, { title });
                this.status.statusUpdatedSubject$.next(docId);
              }
            } else {
              // need add
              await this.indexer.insert(
                'doc',
                IndexerDocument.from(docId, {
                  docId,
                  title,
                })
              );
              this.status.docsInIndexer.set(docId, { title });
              this.status.statusUpdatedSubject$.next(docId);
            }
          }

          for (const docId of this.status.docsInIndexer.keys()) {
            if (!this.status.docsInRootDoc.has(docId)) {
              await this.indexer.delete('doc', docId);
              await this.indexer.deleteByQuery('block', {
                type: 'match',
                field: 'docId',
                match: docId,
              });
              await this.indexerSync.clearDocIndexedClock(docId);
              this.status.docsInIndexer.delete(docId);
              this.status.statusUpdatedSubject$.next(docId);
            }
          }
          await this.refreshIfNeed();
          // #endregion
        } else {
          // #region crawl doc
          const existingDoc = this.status.docsInIndexer.get(docId);
          if (!existingDoc) {
            // doc is deleted, just skip
            continue;
          }

          const docClock = await this.doc.getDocTimestamp(docId);
          if (!docClock) {
            // doc is deleted, just skip
            continue;
          }

          const docIndexedClock =
            await this.indexerSync.getDocIndexedClock(docId);
          if (
            docIndexedClock &&
            docIndexedClock.timestamp.getTime() ===
              docClock.timestamp.getTime() &&
            docIndexedClock.indexerVersion === indexVersion
          ) {
            // doc is already indexed, just skip
            continue;
          }

          console.log('[indexer] start indexing doc', docId);

          let blocks: IndexerDocument<'block'>[] = [];
          let preview: string | undefined;

          const nativeResult = await this.tryNativeCrawlDocData(docId);
          if (nativeResult) {
            blocks = nativeResult.block;
            preview = nativeResult.summary;
          } else {
            const docBin = await this.doc.getDoc(docId);
            if (!docBin) {
              // doc is deleted, just skip
              continue;
            }
            const docYDoc = new YDoc({ guid: docId });
            applyUpdate(docYDoc, docBin.bin);

            try {
              const result = await crawlingDocData({
                ydoc: docYDoc,
                rootYDoc: this.status.rootDoc,
                spaceId: this.status.rootDocId,
                docId,
              });
              if (!result) {
                // doc is empty without root block, just skip
                continue;
              }
              blocks = result.blocks;
              preview = result.preview;
            } catch (error) {
              console.error('error crawling doc', error);
            }
          }

          await this.indexer.deleteByQuery('block', {
            type: 'match',
            field: 'docId',
            match: docId,
          });

          for (const block of blocks) {
            await this.indexer.insert('block', block);
          }

          if (preview) {
            await this.indexer.update(
              'doc',
              IndexerDocument.from(docId, {
                summary: preview,
              })
            );
          }

          await this.refreshIfNeed();

          await this.indexerSync.setDocIndexedClock({
            docId,
            timestamp: docClock.timestamp,
            indexerVersion: indexVersion,
          });
          // #endregion
        }

        console.log('[indexer] complete job', docId);
        await this.refreshIfNeed();

        this.status.completeJob();
      }
    } finally {
      await this.refreshIfNeed();
      unsubscribe();
    }
  }

  // ensure the indexer is refreshed according to recommendRefreshInterval
  // recommendRefreshInterval <= 0 means force refresh on each operation
  // recommendRefreshInterval > 0 means refresh if the last refresh is older than recommendRefreshInterval
  private async refreshIfNeed(): Promise<void> {
    const recommendRefreshInterval = this.indexer.recommendRefreshInterval ?? 0;
    const needRefresh =
      recommendRefreshInterval > 0 &&
      this.lastRefreshed + recommendRefreshInterval < Date.now();
    const forceRefresh = recommendRefreshInterval <= 0;
    if (needRefresh || forceRefresh) {
      await this.indexer.refreshIfNeed();
      this.lastRefreshed = Date.now();
    }
  }

  private async tryNativeCrawlDocData(docId: string) {
    try {
      const result = await this.doc.crawlDocData?.(docId);
      if (result) {
        return {
          title: result.title,
          block: result.blocks.map(block =>
            IndexerDocument.from<'block'>(`${docId}:${block.blockId}`, {
              docId,
              blockId: block.blockId,
              content: block.content,
              flavour: block.flavour,
              blob: block.blob,
              refDocId: block.refDocId,
              ref: block.refInfo,
              parentFlavour: block.parentFlavour,
              parentBlockId: block.parentBlockId,
              additional: block.additional,
            })
          ),
          summary: result.summary,
        };
      }
      return null;
    } catch (error) {
      console.warn('[indexer] native crawlDocData failed', docId, error);
      return null;
    }
  }

  private async getAllDocsFromIndexer() {
    const docs = await this.indexer.search(
      'doc',
      {
        type: 'all',
      },
      {
        pagination: {
          limit: Infinity,
        },
        fields: ['docId', 'title'],
      }
    );

    return new Map(
      docs.nodes.map(node => {
        const title = node.fields.title;
        return [
          node.id,
          {
            title: typeof title === 'string' ? title : title.at(0),
          },
        ];
      })
    );
  }

  async search<T extends keyof IndexerSchema, const O extends SearchOptions<T>>(
    table: T,
    query: Query<T>,
    options?: O & { prefer?: IndexerPreferOptions }
  ): Promise<SearchResult<T, O>> {
    if (
      options?.prefer === 'remote' &&
      this.remote &&
      !(this.remote instanceof DummyIndexerStorage)
    ) {
      await this.remote.connection.waitForConnected();
      return await this.remote.search(table, query, omit(options, 'prefer'));
    } else {
      await this.indexer.connection.waitForConnected();
      return await this.indexer.search(table, query, omit(options, 'prefer'));
    }
  }

  async aggregate<
    T extends keyof IndexerSchema,
    const O extends AggregateOptions<T>,
  >(
    table: T,
    query: Query<T>,
    field: keyof IndexerSchema[T],
    options?: O & { prefer?: IndexerPreferOptions }
  ): Promise<AggregateResult<T, O>> {
    if (
      options?.prefer === 'remote' &&
      this.remote &&
      !(this.remote instanceof DummyIndexerStorage)
    ) {
      await this.remote.connection.waitForConnected();
      return await this.remote.aggregate(
        table,
        query,
        field,
        omit(options, 'prefer')
      );
    } else {
      await this.indexer.connection.waitForConnected();
      return await this.indexer.aggregate(
        table,
        query,
        field,
        omit(options, 'prefer')
      );
    }
  }

  search$<T extends keyof IndexerSchema, const O extends SearchOptions<T>>(
    table: T,
    query: Query<T>,
    options?: O & { prefer?: IndexerPreferOptions }
  ): Observable<SearchResult<T, O>> {
    if (
      options?.prefer === 'remote' &&
      this.remote &&
      !(this.remote instanceof DummyIndexerStorage)
    ) {
      const remote = this.remote;
      return fromPromise(signal =>
        remote.connection.waitForConnected(signal)
      ).pipe(
        switchMap(() => remote.search$(table, query, omit(options, 'prefer')))
      );
    } else {
      return fromPromise(signal =>
        this.indexer.connection.waitForConnected(signal)
      ).pipe(
        switchMap(() =>
          this.indexer.search$(table, query, omit(options, 'prefer'))
        )
      );
    }
  }

  aggregate$<
    T extends keyof IndexerSchema,
    const O extends AggregateOptions<T>,
  >(
    table: T,
    query: Query<T>,
    field: keyof IndexerSchema[T],
    options?: O & { prefer?: IndexerPreferOptions }
  ): Observable<AggregateResult<T, O>> {
    if (
      options?.prefer === 'remote' &&
      this.remote &&
      !(this.remote instanceof DummyIndexerStorage)
    ) {
      const remote = this.remote;
      return fromPromise(signal =>
        remote.connection.waitForConnected(signal)
      ).pipe(
        switchMap(() =>
          remote.aggregate$(table, query, field, omit(options, 'prefer'))
        )
      );
    } else {
      return fromPromise(signal =>
        this.indexer.connection.waitForConnected(signal)
      ).pipe(
        switchMap(() =>
          this.indexer.aggregate$(table, query, field, omit(options, 'prefer'))
        )
      );
    }
  }
}

class IndexerSyncStatus {
  isReadonly = false;
  prioritySettings = new Map<string, number>();
  jobs = new AsyncPriorityQueue();
  rootDoc = new YDoc({ guid: this.rootDocId });
  rootDocReady = false;
  docsInIndexer = new Map<string, { title: string | undefined }>();
  docsInRootDoc = new Map<string, { title: string | undefined }>();
  currentJob: string | null = null;
  errorMessage: string | null = null;
  statusUpdatedSubject$ = new Subject<string | true>();
  paused: {
    promise: Promise<void>;
    resolve: () => void;
  } | null = null;
  batterySaveMode: boolean = false;

  state$ = new Observable<IndexerSyncState>(subscribe => {
    const next = () => {
      if (this.isReadonly) {
        subscribe.next({
          indexing: 0,
          total: 0,
          errorMessage: this.errorMessage,
          completed: true,
          batterySaveMode: this.batterySaveMode,
          paused: this.paused !== null,
        });
      } else {
        subscribe.next({
          indexing: this.jobs.length() + (this.currentJob ? 1 : 0),
          total: this.docsInRootDoc.size + 1,
          errorMessage: this.errorMessage,
          completed: this.rootDocReady && this.jobs.length() === 0,
          batterySaveMode: this.batterySaveMode,
          paused: this.paused !== null,
        });
      }
    };
    next();
    const dispose = this.statusUpdatedSubject$.subscribe(() => {
      next();
    });
    return () => {
      dispose.unsubscribe();
    };
  }).pipe(
    share({
      connector: () => new ReplaySubject(1),
    })
  );

  docState$(docId: string) {
    return new Observable<IndexerDocSyncState>(subscribe => {
      const next = () => {
        if (this.isReadonly) {
          subscribe.next({
            indexing: false,
            completed: true,
          });
        } else {
          subscribe.next({
            indexing: this.jobs.has(docId),
            completed: this.docsInIndexer.has(docId) && !this.jobs.has(docId),
          });
        }
      };
      next();
      const dispose = this.statusUpdatedSubject$.subscribe(updatedDocId => {
        if (updatedDocId === docId || updatedDocId === true) {
          next();
        }
      });
      return () => {
        dispose.unsubscribe();
      };
    }).pipe(
      share({
        connector: () => new ReplaySubject(1),
      })
    );
  }

  constructor(readonly rootDocId: string) {
    this.prioritySettings.set(this.rootDocId, Infinity);
  }

  scheduleJob(docId: string) {
    const priority = this.prioritySettings.get(docId) ?? 0;
    this.jobs.push(docId, priority);
    this.statusUpdatedSubject$.next(docId);
  }

  async acceptJob(abort?: AbortSignal) {
    if (this.paused) {
      await this.paused.promise;
    }
    const job = await this.jobs.asyncPop(
      // if battery save mode is enabled, only accept jobs with priority > 1; otherwise accept all jobs
      this.batterySaveMode ? 1 : undefined,
      abort
    );
    this.currentJob = job;
    this.statusUpdatedSubject$.next(job);
    return job;
  }

  completeJob() {
    const job = this.currentJob;
    this.currentJob = null;
    this.statusUpdatedSubject$.next(job ?? true);
  }

  addPriority(id: string, priority: number) {
    const oldPriority = this.prioritySettings.get(id) ?? 0;
    this.prioritySettings.set(id, priority);
    this.jobs.setPriority(id, oldPriority + priority);

    return () => {
      const currentPriority = this.prioritySettings.get(id) ?? 0;
      this.prioritySettings.set(id, currentPriority - priority);
      this.jobs.setPriority(id, currentPriority - priority);
    };
  }

  enableBatterySaveMode() {
    if (this.batterySaveMode) {
      return;
    }
    this.batterySaveMode = true;
    this.statusUpdatedSubject$.next(true);
  }

  disableBatterySaveMode() {
    if (!this.batterySaveMode) {
      return;
    }
    this.batterySaveMode = false;
    this.statusUpdatedSubject$.next(true);
  }

  pauseSync() {
    if (this.paused) {
      return;
    }
    this.paused = Promise.withResolvers();
    this.statusUpdatedSubject$.next(true);
  }

  resumeSync() {
    if (!this.paused) {
      return;
    }
    this.paused.resolve();
    this.paused = null;
    this.statusUpdatedSubject$.next(true);
  }

  reset() {
    // reset all state, except prioritySettings
    this.isReadonly = false;
    this.jobs.clear();
    this.docsInRootDoc.clear();
    this.docsInIndexer.clear();
    this.rootDoc = new YDoc();
    this.rootDocReady = false;
    this.currentJob = null;
    this.batterySaveMode = false;
    this.paused = null;
    this.statusUpdatedSubject$.next(true);
  }
}
