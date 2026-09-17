/**
 * #151 段階3 PR5-b: **共有目次（`meta.pages`）から題を消す。**
 *
 * ```
 * # 試し行い（既定・何も書き換えない）
 * node dist/src/scripts/purge-index.js
 *
 * # 実際に消す
 * node dist/src/scripts/purge-index.js --apply
 * ```
 *
 * ⚠️ **既定は試し行い。** `--apply` を付けたときだけ書き換える。
 * うっかり本番で消さないため。
 *
 * ⚠️ **`src/` の下に置くこと。** 本番イメージには `scripts/` も `src/` も
 * 入っておらず、`dist/` と `node_modules` しか無い。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.8
 */
import 'dotenv/config';
import { PrismaService } from '../prisma.service';
import { IndexPurgeService } from '../modules/discovery/index-purge.service';

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaService();
  const purge = new IndexPurgeService(prisma);

  console.log(
    apply
      ? '⚠️ 実行モード: 目次を書き換えます'
      : '試し行い: 何も書き換えません（--apply で実行）',
  );

  try {
    const workspaces = await prisma.workspace.findMany({
      select: { id: true, name: true },
    });

    let purged = 0;
    let spacesPurged = 0;
    let kept = 0;
    let conflicts = 0;

    for (const ws of workspaces) {
      const label = `${ws.name ?? '(名前なし)'} [${ws.id.slice(0, 8)}]`;
      const r = await purge.purgeWorkspace(ws.id, !apply);

      // ⚠️ **目次が 0 件でも飛ばさないこと。** PR5-b のあとがまさにその状態で、
      // 目次は空でも `spaces` に docId が残っている（7.9）
      if (r.indexed === 0 && r.spacesIndexed === 0) {
        console.log(`--  ${label}: 目次なし`);
        continue;
      }

      // ⚠️ **書き換えていないものを「消した」に数えないこと。**
      // 競合で中止したときも `purged` には対象件数が入っているため、
      // そのまま足すと**何も書いていないのに「消した N 件」**と報告する
      const wrote = !apply || r.applied;
      if (wrote) {
        purged += r.purged;
        spacesPurged += r.spacesPurged;
      }
      kept += r.kept.length;
      if (r.retriedForConflict) conflicts++;

      const mark = r.retriedForConflict ? '★競合' : r.kept.length > 0 ? '△残' : 'OK ';
      console.log(
        `${mark} ${label}: 目次 ${r.indexed} 件 → ` +
          `${wrote ? (apply ? '消した' : '消せる') : '中止（対象'} ${r.purged} 件${wrote ? '' : '）'}` +
          `・残す ${r.kept.length} 件` +
          // #151 PR5-c: 題が消えても docId が残れば存在は漏れる（7.9）
          `／docId ${r.spacesIndexed} 件 → ${wrote ? r.spacesPurged : 0} 件` +
          (apply ? `・履歴 ${r.historiesDeleted} 件削除` : ''),
      );

      // ⚠️ **残した理由を必ず出す。** 黙って残すと、
      // 「掃除したのに漏れている」原因が追えない
      for (const k of r.kept.slice(0, 10)) {
        console.log(`      残す: ${k.docId ?? `#${k.index}`} — ${k.reason}`);
      }

      if (r.retriedForConflict) {
        console.log(
          '      ⚠️ 掃除中に他の書き込みが入ったため中止した。やり直すこと',
        );
      }

      // ⚠️ **「消した」ではなく「どこにも無い」を確かめる**（7.8.7d）
      if (apply && r.applied) {
        const v = await purge.verify(ws.id);
        console.log(
          `      確認: 目次 ${v.indexed} 件 / docId ${v.spaces} 件 / ` +
            `更新ログ ${v.updates} 件 / 履歴 ${v.histories} 件`,
        );
        if (v.spaces > 0) {
          console.log('      ⚠️ docId が残っている。ここから存在が分かる');
        }
        if (v.histories > 0) {
          console.log('      ⚠️ 履歴が残っている。ここから題が取れる');
        }
      }
    }

    console.log(
      `\n合計: ${apply ? '消した' : '消せる'} 題 ${purged} 件` +
        `／docId ${spacesPurged} 件 / 残す ${kept} 件` +
        (conflicts > 0 ? ` / 競合で中止 ${conflicts} 件` : ''),
    );

    if (conflicts > 0) {
      console.log('判定: ★やり直しが要る（競合で中止したワークスペースがある）');
      return 1;
    }
    if (!apply) {
      console.log('判定: 試し行い完了。実行するには --apply を付ける');
      return 0;
    }
    console.log(
      kept > 0
        ? '判定: 完了（ただし残したものがある。理由は上記）'
        : '判定: ✅ 完了',
    );
    return 0;
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
