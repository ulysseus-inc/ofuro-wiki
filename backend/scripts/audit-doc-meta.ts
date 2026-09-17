/**
 * #151: Yjs の目次と `doc_meta`（台帳）が一致しているかを検査する。
 *
 * 段階2-2 で一覧の表示元を台帳へ切り替える前に、
 * 「全件一致している」ことを**実データで**示すために使う。
 *
 * ```
 * npm run audit:doc-meta
 * ```
 *
 * ⚠️ 異常があれば**終了コード 1** で終わる。
 * 目視に頼ると、件数が多いときに見落とす。
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma.service';
import { DocMetaAuditService } from '../src/modules/discovery/doc-meta-audit.service';
import { IndexReaderService } from '../src/modules/discovery/index-reader.service';

async function main(): Promise<number> {
  const prisma = new PrismaService();
  // 目次を読むだけ（検査は何も書き換えない）
  const sync = new IndexReaderService(prisma);
  const audit = new DocMetaAuditService(prisma, sync);

  try {
    const result = await audit.auditAll();

    for (const ws of result.workspaces) {
      const label = `${ws.name ?? '(名前なし)'} [${ws.workspaceId.slice(0, 8)}]`;
      if (ws.noIndex) {
        console.log(`- ${label}: 目次なし（未同期）`);
        continue;
      }
      const ng = ws.missing.length + ws.mismatched.length;
      const mark = ng === 0 ? 'OK ' : '★NG';
      console.log(
        `${mark} ${label}: 目次 ${ws.indexed} / 台帳 ${ws.recorded}` +
          `（欠落 ${ws.missing.length}・不一致 ${ws.mismatched.length}・台帳のみ ${ws.extra}）`,
      );
      for (const id of ws.missing.slice(0, 10)) {
        console.log(`      欠落: ${id}`);
      }
      for (const m of ws.mismatched.slice(0, 10)) {
        console.log(`      不一致: ${m.docId} — ${m.reasons.join(' / ')}`);
      }
    }

    const ng = result.missing + result.mismatched;
    console.log('');
    console.log(
      `合計: 目次 ${result.indexed} 件 / 欠落 ${result.missing} 件 / ` +
        `不一致 ${result.mismatched} 件 / 台帳のみ ${result.extra} 件`,
    );
    // 「台帳のみ」は内部API 由来で設計上ありうるため、異常に数えない
    console.log(ng === 0 ? '判定: 一致' : '判定: ★不一致あり');
    return ng === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error('検査に失敗しました:', e);
    process.exit(2);
  },
);
