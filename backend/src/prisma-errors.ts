/**
 * Prisma のエラー判別。
 *
 * ⚠️ **一意制約違反（P2002）を「失敗」と扱わない場面がある。**
 * 同じ行を複数の処理が同時に作りにいく設計（スナップショットの初回作成など）では、
 * 負けたほうは**やり直せばよい**だけで、例外を投げると呼び出し元が壊れる。
 */
export function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === 'P2002';
}
