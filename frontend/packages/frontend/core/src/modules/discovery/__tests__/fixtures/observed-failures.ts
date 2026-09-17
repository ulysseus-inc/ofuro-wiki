/**
 * #151: **実測したサーバー応答**（2026-08-09、開発環境で採取）。
 *
 * ⚠️ **推測で書かないこと。** 実測せずに実装したため、
 * 「GraphQL の認可拒否は HTTP 200 で返る」ことに気づかず、
 * **HTTP status で判定して何も判定できていない**修正を入れた
 * （レビュー5巡目で発覚）。
 *
 * 応答の形が変わったら、**実際に叩いてここを更新すること。**
 */

/** `fetcher.ts` が投げる形（`extensions` に status を載せている）。 */
export interface ObservedFailure {
  /** 何が起きた場面か */
  readonly scene: string;
  /** 実測した HTTP status */
  readonly http: number;
  /** 実測した `extensions.code`（GraphQL 層に届いた場合のみ） */
  readonly code?: string;
  /** 通信そのものが失敗した場合 */
  readonly thrownType?: string;
  /** そのときあるべき判定 */
  readonly expected: 'rejected' | 'unreachable' | 'invalid';
  /** なぜその判定なのか */
  readonly why: string;
}

export const OBSERVED_FAILURES: readonly ObservedFailure[] = [
  {
    scene: '認証なし（サインインしていない・トークン失効）',
    http: 200,
    code: 'UNAUTHENTICATED',
    expected: 'rejected',
    why: '⚠️ HTTP は 200。status で判定すると見逃す',
  },
  {
    scene: '非メンバーのワークスペースを引いた（権限剥奪後もこれ）',
    http: 200,
    code: 'FORBIDDEN',
    expected: 'rejected',
    why: '⚠️ HTTP は 200。**この機能が守ろうとしている本命の場面**',
  },
  {
    scene: '存在しないワークスペース',
    http: 200,
    code: 'INTERNAL_SERVER_ERROR',
    expected: 'unreachable',
    why:
      '⚠️ 実測では 404 ではなく INTERNAL_SERVER_ERROR。' +
      '権限の問題ではないため、キャッシュを消さない側へ倒す',
  },
  {
    scene: '壊れたクエリ（実装の誤り）',
    http: 400,
    code: 'GRAPHQL_VALIDATION_FAILED',
    expected: 'unreachable',
    why: '権限の問題ではない。キャッシュを消す理由がない',
  },
  {
    scene: 'サーバーが落ちている・通信できない',
    http: 0,
    thrownType: 'TypeError',
    expected: 'unreachable',
    why: 'オフラインの例外規定が働く場面',
  },
  {
    scene: 'GraphQL 層に届かない応答（プロキシの HTML 等）',
    http: 404,
    expected: 'unreachable',
    why:
      'code が無い。⚠️ 502/503 も同じ形になるため、' +
      '**キャッシュを消さない側へ倒す**（消すと一時障害で一覧が消える）',
  },
  {
    scene: 'プロキシ・認証ミドルウェアが 401/403 を返す',
    http: 403,
    expected: 'rejected',
    why: 'GraphQL 層に届かない拒否。code は無いが status で分かる',
  },
] as const;
