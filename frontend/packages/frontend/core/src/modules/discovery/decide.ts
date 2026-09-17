import type { DiscoveryCacheEntry } from './stores/discovery-cache';

/**
 * #151: **キャッシュを使ってよいかの判定。**
 *
 * > ⚠️ **キャッシュは権限情報の正本ではない。**
 * > 認可済み Snapshot の一時的な複製であり、
 * > **TTL によって権限失効を遅延させてはならない。**
 *
 * | 状況 | 判定 |
 * |---|---|
 * | サーバーに繋がる・版数が一致 | `use-cache` |
 * | サーバーに繋がる・版数が違う | `fetch`（**キャッシュを信用しない**） |
 * | **サーバーが拒否した** | `fail`（**キャッシュを使わない**） |
 * | サーバーに繋がらない・手元にある | `use-offline-cache`（**例外として許容**） |
 * | サーバーに繋がらない・手元にも無い | `fail`（**黙って空にしない**） |
 *
 * ⚠️ **「繋がらない」と「拒否された」を必ず区別すること。**
 * 権限を剥奪されると `discoveryRevision` は**拒否**される。これを
 * 「繋がらない」と同じに扱うと、**オンラインなのに古い一覧を見せ続ける**
 * ことになり、この仕組みが守ろうとしている性質そのものを破る。
 *
 * ⚠️ **判定だけをここに置く**（副作用なし）。DI の基底クラスから切り離すことで、
 * 仕様の中核を単体で検証できるようにしている。
 */
export function decideDiscoverySource(input: {
  cached: DiscoveryCacheEntry | undefined;
  /** サーバーの版数。取れなかった場合は `null` */
  serverRevision: string | null;
  /**
   * ⚠️ 版数を取れなかった理由。
   *
   * - `unreachable` … 通信できない（オフライン）
   * - `rejected` … **サーバーが拒否した**（権限剥奪・認証切れ等）
   */
  failure?: DiscoveryFailure;
}): DiscoveryDecision {
  const { cached, serverRevision, failure } = input;

  // ⚠️ **拒否はオフラインではない。** キャッシュを使ってはいけない
  if (failure === 'rejected') return 'fail';

  if (serverRevision === null) {
    // ⚠️ ここだけがキャッシュを無条件で使ってよい場面。
    // 一覧を全部隠すと Wiki として使い物にならないため許容する。
    // 復帰時には必ず版数を検証すること
    return cached ? 'use-offline-cache' : 'fail';
  }

  // ⚠️ 「まだ新しいから」ではなく「サーバーと同じだから」使う。
  // 時間で判断しない
  if (cached && cached.revision === serverRevision) return 'use-cache';

  return 'fetch';
}

/** 版数を取れなかった理由。**扱いが正反対になるため必ず区別する。** */
export type DiscoveryFailure = 'unreachable' | 'rejected';

export type DiscoveryDecision =
  | 'use-cache'
  | 'use-offline-cache'
  | 'fetch'
  | 'fail';

/**
 * 版数を取れなかった理由を見分ける。
 *
 * ⚠️ **どちらに寄せても害が出る。両方向を意識すること。**
 *
 * | 誤り | 起きること |
 * |---|---|
 * | 拒否をオフライン扱い | **権限を剥奪されてもキャッシュを見せ続ける** |
 * | 障害を拒否扱い | **一時的な 502 でキャッシュを消し、一覧が消える** |
 *
 * ## ⚠️ HTTP status では判定できない
 *
 * **GraphQL の認可拒否は HTTP 200 で返る**（実測）。
 *
 * ```
 * 認証なし        → 200 / extensions.code = UNAUTHENTICATED
 * 非メンバーのWS  → 200 / extensions.code = FORBIDDEN
 * ```
 *
 * 一度 `extensions.status`（HTTP status）だけで判定したが、
 * **常に 200 のため何も判定できていなかった。**
 * `extensions.code` を見ること。
 *
 * status も併せて見るのは、**GraphQL 層に届かない拒否**のため
 * （プロキシや認証ミドルウェアが 401/403 を返す経路）。
 *
 * 判断がつかないものは、キャッシュを残す側（`unreachable`）へ倒す。
 */
export function classifyFailure(e: unknown): DiscoveryFailure {
  // ⚠️ **形が2つある。実物を採取して確認した**（2026-08-25）。
  //
  // | 投げ元 | 形 |
  // |---|---|
  // | GraphQL のエラーをそのまま | `e.extensions.code` |
  // | **`UserFriendlyError`（実際にアプリが投げるもの）** | **`e.code`** |
  //
  // ⚠️ `UserFriendlyError` は `GraphQLError.extensions` を**展開して**
  // 作られるため（`common/error`）、**`extensions` を持たない**。
  // 片方だけを見ると、**権限拒否を一度も検出できず、
  // 通らない要求を延々と再送し続ける**。
  const err = e as {
    code?: string;
    status?: number;
    extensions?: {
      status?: number;
      code?: string;
      originalError?: { statusCode?: number };
    };
  };
  const ext = err?.extensions;

  // ⚠️ **これが本命。** GraphQL の拒否は HTTP 200 で返るため、
  // code を見ないと権限剥奪を検出できない
  const code = ext?.code ?? err?.code;
  if (code && REJECTED_CODES.has(code)) return 'rejected';

  // GraphQL 層に届かない拒否（プロキシ・認証ミドルウェア）
  //
  // ⚠️ **`??` でつないではいけない。** 手前に認可と無関係な値（200 や 500）が
  // 入っていると、そこで止まって**後ろの 403 に辿り着けず、拒否を
  // 通信失敗と取り違えて延々と再送する**。
  // 実測の応答は `extensions.status` を持たず `originalError.statusCode` に
  // 403 を置く形だった（2026-08-25）。**候補をすべて調べる。**
  const statuses = [ext?.status, err?.status, ext?.originalError?.statusCode];
  if (statuses.some(s => s === 401 || s === 403)) return 'rejected';

  return 'unreachable';
}

/**
 * 認可の拒否を表すコード。
 *
 * ⚠️ バックエンドが返す実際の値に合わせること。
 * **実測（2026-08-25）**: 非メンバーが `setDocTitle` を叩くと
 * `extensions.code = "FORBIDDEN"`、`originalError.statusCode = 403`。
 */
const REJECTED_CODES = new Set([
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'UNAUTHORIZED',
]);
