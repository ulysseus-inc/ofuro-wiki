/**
 * #151 段階3 PR5-b: **共有目次（`meta.pages`）を消してよいかを点検する。**
 *
 * ```
 * # 開発環境
 * npm run audit:index-removal
 *
 * # 本番（コンテナ内）
 * node dist/src/scripts/audit-index-removal.js
 * ```
 *
 * ⚠️ **`src/` の下に置くこと。** 本番イメージには `scripts/` も `src/` も
 * 入っておらず、`dist/` と `node_modules` しか無い（Dockerfile 参照）。
 * `scripts/` に置くと**本番で実行できない**——点検が本番でできなければ
 * 意味が無い。
 *
 * ⚠️ **これは掃除そのものではない。** 何も書き換えない。
 * 「消して安全か」を判定するだけ。
 *
 * ⚠️ 危険が1件でもあれば**終了コード 1** で終わる。
 * 目視に頼ると、件数が多いときに見落とす。
 */
import 'dotenv/config';
import { PrismaService } from '../prisma.service';
import { IndexReaderService } from '../modules/discovery/index-reader.service';
import { IndexRemovalAuditService } from '../modules/discovery/index-removal-audit.service';

async function main(): Promise<number> {
  const prisma = new PrismaService();
  // 目次を読むだけ（点検は何も書き換えない）
  const sync = new IndexReaderService(prisma);
  const audit = new IndexRemovalAuditService(prisma, sync);

  try {
    const report = await audit.auditAll();

    for (const ws of report.workspaces) {
      const label = `${ws.name ?? '(名前なし)'} [${ws.workspaceId.slice(0, 8)}]`;
      if (ws.noIndex) {
        console.log(`--  ${label}: 目次なし（掃除するものが無い）`);
        continue;
      }

      const danger = ws.unrecoverable.length + ws.indexAuthoritative.length;
      const mark = ws.changedDuringAudit
        ? '★不定'
        : danger === 0
          ? 'OK '
          : '★危険';
      console.log(
        `${mark} ${label}: 目次 ${ws.indexed} 件` +
          `（復元不能 ${ws.unrecoverable.length}・目次が正 ${ws.indexAuthoritative.length}` +
          `・古いだけ ${ws.safeStale}）`,
      );

      for (const u of ws.unrecoverable.slice(0, 10)) {
        console.log(
          `      復元不能: ${u.docId} 題=${JSON.stringify(u.title)} — ${u.reason}`,
        );
      }
      for (const a of ws.indexAuthoritative.slice(0, 10)) {
        console.log(`      目次が正: ${a.docId} — ${a.reasons.join(' / ')}`);
      }
      if (ws.changedDuringAudit) {
        console.log(
          '      ⚠️ 点検中に目次が動いた。見落としている可能性がある',
        );
      }
    }

    const danger = report.unrecoverable + report.indexAuthoritative;
    console.log(
      `\n合計: 目次 ${report.indexed} 件 / 復元不能 ${report.unrecoverable} 件` +
        ` / 目次が正 ${report.indexAuthoritative} 件 / 古いだけ ${report.safeStale} 件`,
    );

    // ⚠️ **動いていたら「安全」と答えないこと。** 見落とした分が
    // 掃除で失われる。書き込みが止まっている時間帯に取り直す
    if (report.changedDuringAudit > 0) {
      console.log(
        `判定: ★不定 — 点検中に ${report.changedDuringAudit} 件の` +
          'ワークスペースで目次が動いた。**この結果を根拠に掃除しないこと。**',
      );
      return 1;
    }

    if (danger === 0) {
      console.log('判定: ✅ 目次を消しても失われる情報はない');
      console.log(
        '⚠️ これは**この瞬間**の判定。掃除するときは、掃除の側でも' +
          '1件ずつ確かめること（点検からの時間で状況は変わる）',
      );
      return 0;
    }

    console.log(
      `判定: ★危険 ${danger} 件。**消すと情報が失われる。** 先に台帳へ写すこと`,
    );
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
