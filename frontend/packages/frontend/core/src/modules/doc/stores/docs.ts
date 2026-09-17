import type { DocMode } from '@blocksuite/affine/model';
import type { DocMeta } from '@blocksuite/affine/store';
import {
  Store,
  yjsGetPath,
  yjsObserve,
  yjsObserveDeep,
} from '@toeverything/infra';
import { nanoid } from 'nanoid';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  connectable,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  filter,
  from,
  fromEvent,
  map,
  merge,
  Observable,
  of,
  ReplaySubject,
  startWith,
  switchMap,
  take,
  tap,
  timer,
} from 'rxjs';
import { Array as YArray, Map as YMap } from 'yjs';

// ⚠️ バレル経由にしない（modules/doc/index.ts の注記と同じ理由で循環する）
import { AuthService } from '../../cloud/services/auth';
import { ledgerReady$ } from '../ledger-ready';
import type { WorkspaceServerService } from '../../cloud/services/workspace-server';
import type { DiscoveryCacheDocument } from '../../discovery/stores/discovery-cache';
import type { ServerDocMeta } from '../../discovery/reconcile';
import { keepNewerLocal } from '../../discovery/reconcile';
import { toDocMeta } from '../../discovery/to-doc-meta';
import type { DiscoveryService } from '../../discovery/services/discovery';
// ⚠️ バレル経由にしない（循環する）
import type { DocMetaWriteService } from '../../discovery/services/doc-meta-write';
import type { WorkspaceService } from '../../workspace';
import type { DocPropertiesStore } from './doc-properties';

/**
 * 目次が動いてから、サーバーへ取りに行くまでの待ち時間。
 *
 * ⚠️ サーバー側の写し取りが 3 秒のデバウンスで動く
 * （`DocMetaSyncService`）。それより短くすると**写る前に取りに行き**、
 * 古い一覧を掴む。少し長めに待つ。
 */
const REFETCH_DELAY_MS = 3500;

/**
 * 作りたてのページを、台帳に載るまで一覧へ足しておく時間。
 *
 * ⚠️ 写し取りの遅れ（サーバー 3 秒 + フロント 3.5 秒）より**十分長く**取る。
 * 短いと、まだ台帳に無いのに一覧から消え、
 * **開いている最中のページが「見つからない」になる**。
 */
const PENDING_TTL_MS = 60_000;

/**
 * 作りたてのページが台帳に載るまで、取り直しを繰り返す間隔と回数。
 *
 * ⚠️ **1回で諦めてはいけない。** 目次の変化を契機に取り直す作りのため、
 * ページを作って**何も入力せずに放置**すると、契機が二度と来ない。
 * サーバーが 3.5 秒に間に合わなければ、そのページは
 * `PENDING_TTL_MS` の経過後に**一覧から消える**。
 *
 * ⚠️ 合計が `PENDING_TTL_MS` を超えないこと（5秒 × 6回 = 30秒）。
 * 超えると、消えたあとに取り直すことになり意味が無い。
 *
 * 繰り返しは軽い。`DiscoveryService.load()` は最初に版数だけを問い合わせ、
 * 変わっていなければ本体を取りに行かない。
 */
const PENDING_RETRY_MS = 5_000;
const PENDING_RETRY_COUNT = 6;

export class DocsStore extends Store {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly docPropertiesStore: DocPropertiesStore,
    // #151: 一覧は**サーバーの台帳**から作る。Yjs の目次には
    // 権限外のページも載っているため、そこから作ると存在が漏れる
    private readonly discoveryService: DiscoveryService,
    // #151 段階3: 台帳の版数を書き込み側へ渡す
    private readonly docMetaWriteService: DocMetaWriteService,
    // ⚠️ AuthService は ServerScope にあり、ここからは直接注入できない。
    // ワークスペースのサーバー経由で取る（modules/db/services/db.ts と同じ作法）
    private readonly workspaceServerService: WorkspaceServerService
  ) {
    super();
  }

  private serverDocsCache$?: Observable<DiscoveryCacheDocument[]>;

  /**
   * 自分がいま作ったばかりで、**まだ台帳に載っていない**ドキュメントの id。
   *
   * ⚠️ これが無いと、`DocsService.open()` が
   * 「Doc record not found」で落ちる（一覧に無い id は開けない実装）。
   * 作成から台帳に載るまで数秒あるため、その間ページを開けない。
   *
   * ⚠️ **他人のページを混ぜてはいけない。** ここに入れてよいのは
   * 「自分がこの画面で作ったもの」だけ。存在を隠す目的はそれで損なわれない。
   */
  private readonly pendingDocIds$ = new BehaviorSubject<string[]>([]);
  private readonly pendingSince = new Map<string, number>();

  /**
   * #151: 一覧の素になる、**認可済みの**ドキュメント一覧。
   *
   * ## なぜ Yjs から作らないか
   *
   * `rootYDoc` の目次には**ワークスペースの全ページ**が載っている。
   * そこから一覧を作ると、読めないページのタイトルまで表示される。
   *
   * ⚠️ 現時点では目次そのものはブラウザに届いたままで、
   * **これだけでは存在を隠しきれない**（開発者ツールから読める）。
   * 同期層で配らないようにするのは段階3。ここはその前提を作る工程。
   *
   * ## 取り直す契機
   *
   * 目次が動いたら取り直す。自分の編集も他人の編集も
   * Yjs 経由で届くので、これで両方拾える。
   */
  private watchServerDocs(): Observable<DiscoveryCacheDocument[]> {
    // ⚠️ **サーバーを持たないワークスペース（ローカル）がある。**
    // その場合に空を返すと、**一覧が丸ごと消える**。
    // サーバーが無いなら認可する相手もいないので、目次から作ってよい
    const authService =
      this.workspaceServerService.server?.scope.get(AuthService);
    if (!authService) return this.watchLocalDocs();

    // ⚠️ 一覧系の watch は同時に何本も購読される。
    // 共有しないと**購読の数だけサーバーへ取りに行く**
    this.serverDocsCache$ ??= this.shareUntilDisposed(
      combineLatest([
        authService.session.account$,
        // ⚠️ **最初の1回は待たない。** 待つと起動直後に一覧が空になる。
        // 2回目以降だけ、サーバーが写し取るのを待ってから取りに行く
        merge(
          of(null),
          this.watchIndexChanged().pipe(debounceTime(REFETCH_DELAY_MS)),
          // ⚠️ 作りたてのページは目次が動かないことがある（作って放置）。
          // 目次の変化だけを契機にすると取り直しが二度と来ない
          this.watchPendingRetry(),
          // #151 段階3: **オンラインに戻ったら取り直す**（7.5.8）。
          // ⚠️ これが無いと、オフライン中の変更を送り直す契機が来ない。
          // 目次は動いていない（自分の変更は Yjs には入っている）ので、
          // watchIndexChanged では拾えない
          this.watchOnline(),
          // #151 PR2: **他の人の変更を知る唯一の契機**（7.11）。
          // ⚠️ これが無いと、同僚が作ったページは**再読み込みするまで
          // 一覧に出ない**。段階2 までは共有目次が動くことが配信を
          // 兼ねていたが、段階3 で目次を空にしてその経路が消えた
          //
          // ⚠️ **まとめること。** 題は打鍵のたびに台帳へ送られ、そのたびに
          // 版数が上がって通知が飛ぶ。まとめないと、**誰かが題を打っている
          // 間ずっと、接続中の全員が一覧を丸ごと取り直す**（人数と
          // ページ数に比例して増える）。隣の `watchIndexChanged` と同じ扱い
          this.watchDiscoveryChanged().pipe(debounceTime(REFETCH_DELAY_MS))
        ),
      ]).pipe(
        switchMap(([account]) => {
          // #199: **認可の主体が変わったら、索引の対象を先に空にする。**
          //
          // ⚠️ 台帳を取り直すまで待ってはいけない。待つあいだ SharedWorker には
          // **前の利用者の対象と本文の索引が残る**ため、共用端末で次の利用者が
          // 手元の検索から前の利用者のページを読める。
          // 認可の境界を跨いだ瞬間に空へ倒し、取得できた時点で入れ直す
          if (
            this.indexedAccountId !== undefined &&
            account?.id !== this.indexedAccountId
          ) {
            // ⚠️ **起動直後に空を送らないこと。** まだ誰の索引でもないうちに
            // 送ると、前回までに作った索引を毎回捨てて作り直すことになる。
            // 「認可の主体が居た状態から変わった」ときだけ空にする
            this.pushIndexTargets([]);
          }
          this.indexedAccountId = account?.id;

          if (!account) {
            // #151 段階3: **誰の変更か分からなくなったので控えるのをやめる。**
            // ⚠️ ここで消さないと、サインアウト後も前の利用者の ID が残り、
            // 共用端末で次の利用者の変更が**前の利用者の未送信分として
            // 保存される**（7.5.8 で userId を持つ目的そのものが崩れる）
            this.docMetaWriteService.userId = undefined;
            // ⚠️ **サインインしていないなら、待つものが無いので決着扱い。**
            // ここを未決着にすると画面が永久に出ない
            this.ledgerSettled$$.next(true);
            return of([] as DiscoveryCacheDocument[]);
          }
          // ⚠️ **取りに行く前に未決着へ戻す。**
          // 起動直後は認証の復元前に account が null になり得る（初期値）。
          // 戻さないと、その一瞬の null で決着とみなされ、
          // **版数を受け取る前に書き込めてしまう**（必ず stale になる）
          this.ledgerSettled$$.next(false);
          // #151 段階3: **いま認証されている利用者を、先に送り主とする。**
          // ⚠️ 利用者を切り替えた直後、台帳が返るまでの窓で
          // **前の利用者の ID として控えてしまう**のを防ぐ。
          // ⚠️ ここで undefined にしてはいけない。取り直しは頻繁に起きるため、
          // そのたびに送り主が消え、**送信待ちの変更が送り主の食い違いと
          // 判定されて送られなくなる**
          this.docMetaWriteService.userId = account.id;
          return from(
            this.discoveryService.load(
              this.workspaceService.workspace.id,
              account.id
            )
          ).pipe(
            map(r => {
              // #151 段階3: 台帳の版数を書き込み側へ渡す。
              // ⚠️ **渡さないと、移行済みのページへの変更が必ず stale になる。**
              // 手元が版数を知らないまま 0 を送るため、サーバーの版数と
              // 食い違う（7.5.10）
              this.docMetaWriteService.hydrateRevisions(r.entry.documents);
              // #151 段階3: **台帳をキャッシュへ入れる**（7.5.5 の初期化完了）。
              // ⚠️ これで `getDocMeta` の供給元が目次から台帳へ変わる。
              // 入れないと、一覧は出るのに**個々のページのメタが空**になる
              this.hydrateMetaCache(r.entry.documents);
              // #151 段階3: 誰の変更として控えるか（7.5.8）。
              // ⚠️ 台帳が返した userId を使う。「誰にとって認可された
              // 結果か」はサーバーの判断が正
              this.docMetaWriteService.userId = r.entry.userId;
              // #151 段階3: **控えてある変更を送り直す**（7.5.8）。
              // ⚠️ **版数を取り込んだあとに呼ぶこと。** 先に呼ぶと 0 を
              // 基準にしてしまい、移行済みのページでは必ず stale になる
              // #151 段階3 / #182: 権限拒否で巻き戻すために、台帳の値を
              // 引ける口を渡す。⚠️ 取り直しのたびに最新へ差し替える
              this.docMetaWriteService.fetchServerMeta = (_ws, docId) =>
                this.fetchServerMeta(docId);
              this.docMetaWriteService.resendPending(
                this.workspaceService.workspace.id
              );
              // ⚠️ **版数を渡したあとに決着とすること。** 先に立てると、
              // 版数が無いまま書き込める窓が開く
              this.ledgerSettled$$.next(true);
              return r.entry.documents;
            }),
            // #151 段階3: **別タブの更新も取り込む**（7.5.9 の1）。
            // ⚠️ いままでタブ間の伝播は Yjs 目次が担っていた（片方の編集が
            // 目次を動かし、もう片方が取り直す）。目次を捨てると
            // **その経路が無くなる**ので、キャッシュの監視で引き継ぐ
            switchMap(documents =>
              merge(
                of(documents),
                this.discoveryService.watch(this.workspaceService.workspace.id, account.id).pipe(
                  // ⚠️ 中身が無い（消された）ときは一覧を空にしない。
                  // 取り直しの契機を待つ
                  filter((entry): entry is NonNullable<typeof entry> => !!entry),
                  map(entry => {
                    // ⚠️ **版数も取り込むこと。** 取り込まないと、別タブの
                    // 書き込みで上がった版数を知らないまま送り、
                    // **自分の変更が stale で捨てられる**
                    this.docMetaWriteService.hydrateRevisions(entry.documents);
                    this.hydrateMetaCache(entry.documents);
                    return entry.documents;
                  })
                )
              )
            ),
            // ⚠️ **ここで投げてはいけない。** 投げると一覧の購読ごと止まり、
            // 以後どの更新も届かなくなる（画面が二度と直らない）。
            // 空を出して、次の契機で取り直す。
            // なお「オフラインで手元にも無い」場合もここへ来る。
            // 一覧は空になるが、**見えてはいけないものを見せるよりはよい**
            catchError(() => {
              // ⚠️ 失敗しても決着とする。待ち続けるとオフラインで
              // 画面が永久に出ない（何を見せるかは decideDiscoverySource が判断）
              this.ledgerSettled$$.next(true);
              return of([] as DiscoveryCacheDocument[]);
            })
          );
        })
      )
    );

    // ⚠️ 目次との合流は**キャッシュの外**でやる。中に入れると
    // 共有された1本の購読に固定され、以後の目次の変化が反映されない
    return combineLatest([
      this.serverDocsCache$,
      this.watchLocalDocs(),
      this.pendingDocIds$,
      // #151 段階3: **キャッシュが動いたら作り直す。**
      // ⚠️ 目次に書かなくなった時点で、目次の変化を契機にした再計算は
      // 二度と起きない。これが無いと、**題を変えてもゴミ箱へ入れても
      // 一覧が変わらない**（実測でゴミ箱の E2E が落ちた）
      this.watchMetaUpdated(),
    ]).pipe(map(([server, local, pending]) => this.merge(server, local, pending)));
  }

  /**
   * 段階2-3: **存在は台帳、中身は目次**（docs/doc-permission.md）。
   *
   * 台帳が「見てよい」と言ったページに限って、題・タグ・ゴミ箱を目次から取る。
   * 目次は手元にあるので**遅れがゼロ**になる。台帳だけで作ると、
   * 題を変えてから画面に出るまで 3.5 秒待たされる。
   *
   * ⚠️ **台帳に無いページは、目次にあっても捨てること。**
   * ここを緩めると存在が漏れる。**目次を「何があるか」の判断に使わない。**
   *
   * ⚠️ **台帳にあって目次に無いページがある。** 内部API 経由のページは
   * 目次に載らないことがある。その場合は台帳の値をそのまま使う
   * （落とすと、そのページが一覧から消える）。
   */
  private merge(
    server: DiscoveryCacheDocument[],
    local: DiscoveryCacheDocument[],
    pending: string[]
  ): DiscoveryCacheDocument[] {
    // #151 段階3: **中身はキャッシュ（台帳＋手元の未反映）から取る。**
    // ⚠️ 目次から取ってはいけない。目次は全メンバーへ配信されるので、
    // **権限外のページの題がそこにある**。加えて、段階3 では目次に
    // 書かなくなるため、取っても古いままになる
    type Overlay = {
      title?: string | null;
      tags?: string[];
      tagIds?: string[];
      trash?: boolean;
      updatedAt?: string;
    };
    const inIndex = new Map<string, Overlay>(
      this.ledgerDriven
        ? this.workspaceService.workspace.docCollection.meta.docMetas.map(
            m => [m.id, m as Overlay] as const
          )
        : local.map(d => [d.id, d as Overlay] as const)
    );
    const visible = server.map(d => {
      const indexed = inIndex.get(d.id);
      if (!indexed) return d;
      if (this.ledgerDriven) {
        return {
          ...d,
          title: indexed.title ?? d.title,
          tagIds: indexed.tags ?? d.tagIds,
          trash: indexed.trash ?? d.trash,
        };
      }
      // ⚠️ 作成者・作成日時は**台帳のものを残す**。目次には作成者が無く、
      // 目次の日時は複製なので、上書きすると一覧の情報が減る
      return {
        ...d,
        title: indexed.title ?? d.title,
        tagIds: indexed.tagIds ?? d.tagIds,
        trash: indexed.trash ?? d.trash,
        updatedAt: indexed.updatedAt ?? d.updatedAt,
      };
    });
    return this.appendPending(visible, local, pending);
  }

  /**
   * 購読を1本にまとめ、**この Store が捨てられたら上流も切る**。
   *
   * ⚠️ `shareReplay({ refCount: false })` を使わないこと。あれは購読者が
   * ゼロになっても上流を切らず、切る手段も無い。ワークスペースを
   * 切り替えるたびに**目次の深い監視が1本ずつ残り続ける**
   * （個人WSと共有WSを行き来する使い方で確実に積み上がる）。
   *
   * ⚠️ `refCount: true` でも駄目。一瞬でも購読者がゼロになると作り直しになり、
   * 画面の切り替えのたびにサーバーへ取りに行く。
   */
  private shareUntilDisposed<T>(source: Observable<T>): Observable<T> {
    const shared = connectable(source, {
      connector: () => new ReplaySubject<T>(1),
      resetOnDisconnect: false,
    });
    const connection = shared.connect();
    this.disposables.push(() => connection.unsubscribe());
    return shared;
  }

  /**
   * 一覧に、作りたてのぶんを足す。
   *
   * ⚠️ **作りたてのページだけは、台帳が答えられない。** まだ載っていないため。
   * これが無いと、作成から数秒間そのページを開けない
   * （`DocsService.open()` は一覧に載っているかを通行証にしている）。
   *
   * 中身は**目次から取る**。ここで作った偽の値を返すと、
   * 台帳に載るまでの間だけ題が消えたり、ゴミ箱へ入れたのに一覧に残ったりする。
   */
  private appendPending(
    server: DiscoveryCacheDocument[],
    local: DiscoveryCacheDocument[],
    pending: string[]
  ): DiscoveryCacheDocument[] {
    if (pending.length === 0) return server;

    const known = new Set(server.map(d => d.id));
    const now = Date.now();
    const waiting = new Set(
      pending.filter(
        id =>
          !known.has(id) &&
          now - (this.pendingSince.get(id) ?? 0) <= PENDING_TTL_MS
      )
    );
    if (waiting.size === 0) return server;

    if (!this.ledgerDriven) {
      return [...server, ...local.filter(d => waiting.has(d.id))];
    }

    // #151 段階3: 作りたてのページはキャッシュにある（`addDocMeta` が
    // 同期で入れる）。⚠️ ここで拾えないと、**作ったページを開けない**
    // （`DocsService.open()` は一覧に載っているかを通行証にしている）
    const cached = this.workspaceService.workspace.docCollection.meta.docMetas;
    const extra = cached
      .filter(m => waiting.has(m.id))
      .map(m => this.fromDocMeta(m));
    return [...server, ...extra];
  }

  /**
   * キャッシュの中身が変わったことを知らせる（#151 段階3）。
   *
   * ⚠️ **最初の1回を出すこと。** 出さないと `combineLatest` が
   * 揃わず、**一覧が永久に出ない**。
   */
  private watchMetaUpdated(): Observable<unknown> {
    return this.workspaceService.workspace.docCollection.meta.docMetaUpdated.pipe(
      startWith(null)
    );
  }

  /**
   * 台帳が Discovery Metadata の供給元か（#151 段階3）。
   *
   * ⚠️ サーバーが無いワークスペース（共有相手がいない）では従来どおり
   * 目次を使う。`WorkspaceMetaImpl` の判断と揃えること。
   */
  private get ledgerDriven(): boolean {
    return !!this.workspaceServerService.server;
  }

  /** キャッシュの1件を、一覧の形へ写す。 */
  private fromDocMeta(m: {
    id: string;
    title?: string | null;
    tags?: string[];
    trash?: boolean;
    createDate?: number;
    updatedDate?: number;
  }): DiscoveryCacheDocument {
    const created = new Date(m.createDate ?? Date.now()).toISOString();
    return {
      id: m.id,
      title: m.title ?? '',
      tagIds: m.tags ?? [],
      mode: 'page',
      trash: m.trash ?? false,
      createdAt: created,
      updatedAt: new Date(m.updatedDate ?? m.createDate ?? Date.now()).toISOString(),
      createdBy: null,
      updatedBy: null,
      // ⚠️ まだ台帳に無いので版数は 0。**作りたてだけの一時的な値**で、
      // 台帳に載ったら本物で置き換わる
      titleRevision: '0',
      trashRevision: '0',
      tagsRevision: '0',
    };
  }

  /**
   * サーバーが無いワークスペース向けに、目次から同じ形を作る。
   *
   * ⚠️ ここは**認可していない**。サーバーが無い＝共有相手がいない
   * ワークスペースでのみ使うこと。
   */
  private watchLocalDocs(): Observable<DiscoveryCacheDocument[]> {
    // ⚠️ 共有すること。一覧系の watch は7本あり、共有しないと
    // **目次の深い監視が7重にかかる**
    return (this.localDocsCache$ ??= this.shareUntilDisposed(
      // #199: サーバーが無いワークスペースでは、目次がそのまま
      // 「認可済み台帳」にあたる。⚠️ ここで渡さないと**索引が始まらない**
      this.buildLocalDocs().pipe(tap(docs => this.pushIndexTargets(docs)))
    ));
  }

  private localDocsCache$?: Observable<DiscoveryCacheDocument[]>;

  private buildLocalDocs(): Observable<DiscoveryCacheDocument[]> {
    return this.watchIndexChanged().pipe(
      map(pages => {
        if (!(pages instanceof YArray)) return [];
        return pages.map((v: YMap<any>) => {
          const tags = v.get('tags');
          return {
            id: v.get('id') as string,
            title: (v.get('title') ?? '') as string,
            tagIds:
              tags instanceof YArray
                ? (tags.toJSON() as string[])
                : ((tags ?? []) as string[]),
            mode: 'page',
            trash: v.get('trash') === true,
            createdAt: new Date((v.get('createDate') ?? 0) as number).toISOString(),
            updatedAt: new Date(
              (v.get('updatedDate') ?? v.get('createDate') ?? 0) as number
            ).toISOString(),
            createdBy: null,
            // ⚠️ Yjs 目次から作る値には版数が無い。0（＝未移行）にする。
            // これは台帳に無いページの一時的な表示にだけ使われる
            titleRevision: '0',
            trashRevision: '0',
            tagsRevision: '0',
            updatedBy: null,
          };
        });
      })
    );
  }

  /**
   * ページを作ったあと、台帳に載るころを見計らって取り直しを促す。
   *
   * ⚠️ 「載ったかどうか」は見ずに、決め打ちの回数で打ち切る。
   * 載ったかを条件にすると、取り直し → 結果 → 取り直しの判断、と
   * **自分の出力を自分の入力にする**輪ができる。
   * 空振りは版数の問い合わせ1回だけなので、割に合う。
   */
  private watchPendingRetry(): Observable<unknown> {
    return this.pendingDocIds$.pipe(
      switchMap(ids =>
        ids.length === 0
          ? EMPTY
          : timer(PENDING_RETRY_MS, PENDING_RETRY_MS).pipe(
              take(PENDING_RETRY_COUNT)
            )
      )
    );
  }

  /**
   * 台帳の内容を、画面が読むキャッシュへ入れる（#151 段階3）。
   *
   * ⚠️ **総入れ替えにすること。** 1件ずつ足すと、権限を外された
   * ページが手元に残り続ける（**存在が漏れる**）。
   */
  private hydrateMetaCache(documents: DiscoveryCacheDocument[]): void {
    const meta = this.workspaceService.workspace.docCollection.meta;

    const metas = documents.map(d => {
      const incoming = toDocMeta(d);
      // ⚠️ **手元のほうが新しい項目は残す**（原則2）。総入れ替えなので、
      // ここで守らないと**送信中の変更が画面から消える**
      const kept = keepNewerLocal(
        {
          meta: incoming,
          revisions: {
            title: d.titleRevision,
            trash: d.trashRevision,
            tags: d.tagsRevision,
          },
        },
        meta.getDocMeta(d.id),
        this.docMetaWriteService.knownRevisions(d.id)
      );
      return { ...incoming, ...kept } as DocMeta;
    });

    // ⚠️ **作りたてのページを消さないこと。** 台帳にはまだ載っていない
    // ため、総入れ替えすると消える。消えると `DocsService.open()` が
    // 通らず、**作ったページを開けない**（段階2-2 で7秒開けなくなったのと
    // 同じ罠）。作成の猶予中のものは手元の値を残す
    const inLedger = new Set(documents.map(d => d.id));
    const keptNew = [...this.pendingSince.keys()]
      .filter(id => !inLedger.has(id))
      .map(id => meta.getDocMeta(id))
      .filter((m): m is DocMeta => !!m);

    const all = [...metas, ...keptNew];
    meta.hydrateFromLedger(all);
    this.pushIndexTargets(all);
  }

  /**
   * #199: **手元の索引の対象を、認可済み台帳に合わせる。**
   *
   * ⚠️ 索引は #151 段階3 まで共有目次から対象を取っていた。目次を空にした
   * ため対象が0件になり、`@` メニューが常に0件になっていた（エラーは出ない）。
   *
   * ⚠️ **追加と削除の両方をここで決める。** 一覧から消えたページは索引からも
   * 消える。「削除された」と「権限を剥奪された」を区別しない——どちらも
   * 検索の対象から外すのが安全側。詳細は docs/client-indexer.md
   */
  /**
   * #199: いまの索引が「誰にとって認可された結果か」。
   *
   * ⚠️ サインアウト・利用者の切り替えを見分けるために持つ。
   * 台帳の取り直しだけを契機にすると、`account` が `null` の分岐は
   * 台帳を取りに行かないため**素通りする**（Codex 指摘・2026-09-10）。
   */
  private indexedAccountId: string | undefined = undefined;

  private pushIndexTargets(
    metas: Array<{ id: string; title?: string | null; trash?: boolean }>
  ): void {
    try {
      this.workspaceService.workspace.engine.indexer.setDocList(
        metas
          // ⚠️ ゴミ箱のページは索引しない（台帳から消えたものと同じ扱い）
          .filter(m => !m.trash)
          // ⚠️ 題も渡す。索引側は題の変化で再索引を判断するため、
          // 渡さないと**題だけ変えたページが検索に反映されない**
          .map(m => ({ docId: m.id, title: m.title ?? undefined }))
      );
    } catch (error) {
      // ⚠️ **ここから例外を出してはいけない。**
      //
      // 呼び出し元は台帳を取り込む流れの中にあり、例外は `catchError` に
      // 拾われて**一覧が空になる**。索引は検索を良くするだけの付随物なのに、
      // それが**サイドバーからページを消す**ことになる。
      //
      // ⚠️ 投げ得る先が実在する: `engine.indexer` は**初期化前に読むと投げる**
      // （`workspace/entities/engine.ts` の `'Engine is not initialized'`）。
      // 新規利用者の初期ワークスペース構築中に台帳が返れば、その窓に入る。
      //
      // ここで握り潰した回は索引に一覧が渡らないが、台帳は取り直すたびに
      // ここへ来るので次の契機で入る（2026-09-10）。
      console.error('failed to update indexer doc list', error);
    }
  }

  /**
   * 台帳から1件のメタを読む（#182 の巻き戻し用）。
   *
   * ⚠️ **台帳を取り直して読む。** 権限拒否は GraphQL の例外として返るため
   * 応答に現在値が入っておらず、手元には拒否された値しか無い。
   *
   * ⚠️ **見えなくなっていたら `undefined` を返す。** 台帳に無いページの
   * メタを作って返すと、**存在を隠すという段階3 の目的に反する**。
   */
  private async fetchServerMeta(
    docId: string
  ): Promise<ServerDocMeta | undefined> {
    const userId = this.docMetaWriteService.userId;
    if (!userId) return undefined;

    const r = await this.discoveryService.load(
      this.workspaceService.workspace.id,
      userId
    );
    const doc = r.entry.documents.find(d => d.id === docId);
    if (!doc) return undefined;

    // ⚠️ 台帳の題は null を取り得る（無題）。手元の題は文字列なので
    // 空文字へ寄せる。undefined にすると「値が無い」として当てられず、
    // **拒否された題が画面に残り続ける**
    return {
      title: doc.title ?? '',
      trash: doc.trash,
      tagIds: doc.tagIds,
    };
  }

  /**
   * オンラインに戻ったことを知らせる。
   *
   * ⚠️ **`online` を信じすぎないこと。** この事象は「OS がネットワークに
   * つながった」だけで、**サーバーが応答するとは限らない**（社内 LAN に
   * 戻ったがサーバーが落ちている、など）。取り直しに失敗しても控えは
   * 残るので、次の契機で改めて送られる。
   *
   * ⚠️ 逆に、サーバーが落ちて復帰した場合はこの事象が起きない。
   * だから既存の取り直し（目次の変化・作成後の再試行）と**併用する**。
   */
  private watchOnline(): Observable<unknown> {
    if (typeof window === 'undefined') return EMPTY;
    return fromEvent(window, 'online');
  }

  /**
   * #151 PR2: サーバーの台帳が変わったことだけを知らせる（7.11）。
   *
   * ⚠️ **中身は運ばれてこない。** 「変わった」という事実だけを受け取り、
   * 取りに行くかどうかは呼び出し先の `load` が版数を見て決める。
   * 重複して届いても、版数を確かめるだけなので実害は無い。
   */
  private watchDiscoveryChanged(): Observable<unknown> {
    return new Observable(subscriber => {
      const storage = this.workspaceService.workspace.engine.doc.storage;
      // ⚠️ ローカルワークスペースには相手がいないので発火しない。
      // 古い保存実装でも落ちないよう、口が無ければ何もしない
      if (typeof storage?.subscribeDiscoveryChanged !== 'function') {
        return () => {};
      }
      return storage.subscribeDiscoveryChanged(() => subscriber.next(null));
    });
  }

  /** 目次が動いたことだけを知らせる（中身は使わない）。 */
  private watchIndexChanged(): Observable<unknown> {
    return yjsGetPath(
      this.workspaceService.workspace.rootYDoc.getMap('meta'),
      'pages'
      // ⚠️ 深く見ること。浅いと**題やタグの変更を拾えず**、
      // 一覧が古いままになる
    ).pipe(switchMap(yjsObserveDeep));
  }

  getBlockSuiteDoc(id: string) {
    return (
      this.workspaceService.workspace.docCollection
        .getDoc(id)
        ?.getStore({ id }) ?? null
    );
  }

  getBlocksuiteCollection() {
    return this.workspaceService.workspace.docCollection;
  }

  createDoc(docId?: string) {
    const id = docId ?? nanoid();

    // #151 段階3: **目次へ直接書かない。** 共有目次は全メンバーへ配信
    // されるため、書くと**権限の無い相手にも題が届く**。
    //
    // ⚠️ `addDocMeta` を通すこと。`docMetaAdded` → `blockCollections.set`
    // の**同期連鎖**がここで成立する必要がある（7.5.1 で実験済み）。
    // 直接キャッシュを触ると、作ったページを開けない
    this.workspaceService.workspace.docCollection.meta.addDocMeta({
      id,
      title: '',
      createDate: Date.now(),
      tags: [],
    });

    // 台帳に載るまでの間、一覧に自分で足しておく（載れば自然に外れる）
    const now = Date.now();
    this.pendingSince.set(id, now);
    // 期限切れはここで捨てる。放っておくと開いている間ずっと溜まる
    for (const [old, since] of this.pendingSince) {
      if (now - since > PENDING_TTL_MS) this.pendingSince.delete(old);
    }
    this.pendingDocIds$.next([...this.pendingSince.keys()]);

    return id;
  }

  watchDocIds() {
    return this.watchServerDocs().pipe(map(docs => docs.map(d => d.id)));
  }

  watchAllDocUpdatedDate() {
    return this.watchServerDocs().pipe(
      map(docs =>
        docs.map(d => ({
          id: d.id,
          updatedDate: new Date(d.updatedAt).getTime(),
        }))
      )
    );
  }

  watchAllDocTagIds() {
    return this.watchServerDocs().pipe(
      map(docs => docs.map(d => ({ id: d.id, tags: d.tagIds })))
    );
  }

  watchAllDocCreateDate() {
    return this.watchServerDocs().pipe(
      map(docs =>
        docs.map(d => ({
          id: d.id,
          createDate: new Date(d.createdAt).getTime(),
        }))
      )
    );
  }

  watchAllDocTitle() {
    return this.watchServerDocs().pipe(
      map(docs => docs.map(d => ({ id: d.id, title: d.title ?? '' })))
    );
  }

  watchNonTrashDocIds() {
    return this.watchServerDocs().pipe(
      map(docs => docs.filter(d => !d.trash).map(d => d.id))
    );
  }

  watchTrashDocIds() {
    return this.watchServerDocs().pipe(
      map(docs => docs.filter(d => d.trash).map(d => d.id))
    );
  }

  watchDocMeta(id: string) {
    if (this.ledgerDriven) {
      // #151 段階3: **目次ではなくキャッシュを見る。**
      // ⚠️ 目次に書かなくなった時点で、ここを直さないと
      // **どこにも題が出なくなる**（実測でゴミ箱の一覧が「無題」になった）。
      // 題の表示はこの経路に乗っている
      return this.watchMetaUpdated().pipe(
        map(
          () =>
            (this.workspaceService.workspace.docCollection.meta.getDocMeta(
              id
            ) ?? {}) as Partial<DocMeta>
        )
      );
    }

    let docMetaIndexCache = -1;
    return yjsGetPath(
      this.workspaceService.workspace.rootYDoc.getMap('meta'),
      'pages'
    ).pipe(
      switchMap(yjsObserve),
      map(meta => {
        if (meta instanceof YArray) {
          if (docMetaIndexCache >= 0) {
            const doc = meta.get(docMetaIndexCache);
            if (doc && doc.get('id') === id) {
              return doc as YMap<any>;
            }
          }

          // meta is YArray, `for-of` is faster then `for`
          let i = 0;
          for (const doc of meta) {
            if (doc && doc.get('id') === id) {
              docMetaIndexCache = i;
              return doc as YMap<any>;
            }
            i++;
          }
          return null;
        } else {
          return null;
        }
      }),
      switchMap(yjsObserveDeep),
      map(meta => {
        if (meta instanceof YMap) {
          return meta.toJSON() as Partial<DocMeta>;
        } else {
          return {};
        }
      })
    );
  }

  /**
   * 一覧を使ってよい状態か。
   *
   * Yjs の同期に加えて、**台帳（Discovery Index）を取り終えるまで待つ**
   * （#151 段階3）。
   *
   * ## なぜ待つのか
   *
   * **版数を先に受け取るため。** 台帳を取る前に書き込むと、手元は版数を
   * 知らないまま 0 を送り、移行済みのページでは**必ず stale になって
   * 台帳へ届かない**（7.5.10）。
   *
   * ## ⚠️ 7.3 の事故（題の上書き）はここでは防いでいない
   *
   * `getDocMeta` が読む `DocMetaCache` は、**いまは Yjs 目次が投入している**
   * （`workspace/impls/meta.ts` の `_syncCacheFromIndex`）。
   * したがって「キャッシュが読めるか」は Yjs の同期状態で決まり、
   * それは**変更前から `state.synced` で担保されていた**。
   *
   * ⚠️ **7.5.5 が言う「台帳がキャッシュへ入った」状態は、まだ存在しない。**
   * 台帳がキャッシュの供給元になるのは、Yjs 目次を捨てる段階（PR5）。
   * そのときにこの判定を `DocMetaCache.isReady` へ寄せること。
   */
  watchDocListReady() {
    return combineLatest([
      this.workspaceService.workspace.engine.doc
        .docState$(this.workspaceService.workspace.id)
        .pipe(map(state => state.synced)),
      this.watchLedgerReady(),
    ]).pipe(map(([synced, ledgerReady]) => synced && ledgerReady));
  }

  /**
   * 台帳がキャッシュへ入ったか。
   *
   * ⚠️ 取得に失敗した場合も**準備完了として扱う**。待ち続けると
   * オフラインで画面が永久に出ない。手元にキャッシュがあればそれを使い、
   * 無ければ空の一覧になる（`decideDiscoverySource` の判断に従う）。
   */
  private watchLedgerReady(): Observable<boolean> {
    // ⚠️ **「何か流れてきた」を決着とみなさないこと。**
    // 起動直後は認証の復元前に account が null になり（LiveData の初期値）、
    // 空配列が1回流れる。それを決着とすると、**版数を受け取る前に
    // 書き込めてしまい、移行済みのページで必ず stale になる**。
    //
    // 取得そのものの完了を `ledgerSettled$$` で明示的に知らせている。
    return ledgerReady$(this.ledgerSettled$$.pipe(filter(Boolean)));
  }

  /**
   * 台帳の取得が決着したか。
   *
   * ⚠️ 「成功した」ではなく「**待つ必要が無くなった**」を表す。
   * 未サインイン・取得失敗も決着に含める（待ち続けると画面が出ない）。
   */
  private readonly ledgerSettled$$ = new BehaviorSubject(false);

  setDocMeta(id: string, meta: Partial<DocMeta>) {
    this.workspaceService.workspace.docCollection.meta.setDocMeta(id, meta);
  }

  setDocPrimaryModeSetting(id: string, mode: DocMode) {
    return this.docPropertiesStore.updateDocProperties(id, {
      primaryMode: mode,
    });
  }

  getDocPrimaryModeSetting(id: string) {
    return this.docPropertiesStore.getDocProperties(id)?.primaryMode;
  }

  watchDocPrimaryModeSetting(id: string) {
    return this.docPropertiesStore.watchDocProperties(id).pipe(
      map(config => config?.primaryMode),
      distinctUntilChanged((p, c) => p === c)
    );
  }

  waitForDocLoadReady(id: string) {
    return this.workspaceService.workspace.engine.doc.waitForDocLoaded(id);
  }

  addPriorityLoad(id: string, priority: number) {
    return this.workspaceService.workspace.engine.doc.addPriority(id, priority);
  }
}
