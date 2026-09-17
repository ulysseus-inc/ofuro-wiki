/**
 * #45: **台帳に無いのに残っているページの実体を消す。**
 *
 * ```
 * # 下見（既定・何も書き換えない）
 * node dist/src/scripts/purge-orphan-docs.js
 *
 * # 実際に消す
 * node dist/src/scripts/purge-orphan-docs.js --apply
 * ```
 *
 * 完全削除が台帳（`doc_meta`）の行しか消していなかった時期に溜まったもの。
 * 一回限りの掃除で、直しそのものは `DocGcService`（docs/permanent-delete.md）。
 *
 * ⚠️ **既定は下見。** `--apply` を付けたときだけ消す。
 * ⚠️ **本番で流す前にバックアップを取る**（docs/backup.md）。
 * ⚠️ **`src/` の下に置くこと。** 本番イメージには `dist/` と
 * `node_modules` しか入っていない。
 */
import 'dotenv/config';
import { PrismaService } from '../prisma.service';
import { isUserDoc } from '../modules/sync/user-doc';

/** 台帳に無く、内部データでもない doc を集める。 */
async function findOrphans(
  prisma: PrismaService,
): Promise<Map<string, Set<string>>> {
  const orphans = new Map<string, Set<string>>();

  const add = (workspaceId: string, docId: string) => {
    // ⚠️ **内部データを外すこと。** ワークスペース自身の doc（目次の実体）や
    // `db$...` は台帳に載らないため、外さないと**目次ごと消す**
    if (!isUserDoc(workspaceId, docId)) return;
    const set = orphans.get(workspaceId) ?? new Set<string>();
    set.add(docId);
    orphans.set(workspaceId, set);
  };

  // ⚠️ **消す表すべてから拾うこと。** どれか1つでも抜けると、
  // その表にだけ残った孤児が見つからない。
  // 例: 索引だけ消えてキュー行が残ると、巡回が消えたページを
  // 延々と作り直そうとする（レビュー指摘 2026-09-17）
  const select = { workspaceId: true, docId: true } as const;
  const distinct = ['workspaceId', 'docId'] as const;
  const [updates, snapshots, histories, indexRows, queueRows] =
    await Promise.all([
      prisma.docUpdate.findMany({ select, distinct: [...distinct] }),
      prisma.docSnapshot.findMany({ select, distinct: [...distinct] }),
      prisma.docHistory.findMany({ select, distinct: [...distinct] }),
      prisma.searchIndex.findMany({ select, distinct: [...distinct] }),
      prisma.searchIndexQueue.findMany({ select, distinct: [...distinct] }),
    ]);

  const seen = new Set<string>();
  for (const row of [
    ...updates,
    ...snapshots,
    ...histories,
    ...indexRows,
    ...queueRows,
  ]) {
    const key = `${row.workspaceId}/${row.docId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const meta = await prisma.docMeta.findUnique({
      where: {
        workspaceId_docId: {
          workspaceId: row.workspaceId,
          docId: row.docId,
        },
      },
      select: { docId: true },
    });
    if (meta) continue;

    add(row.workspaceId, row.docId);
  }

  return orphans;
}

/**
 * ⚠️ **台帳をもう一度見てから消す。**
 *
 * 下見から削除までの間に同じ doc の `doc_meta` が作り直されると、
 * **今は有効なページの本文を消してしまう**。同じトランザクションの中で
 * 確かめ、まだ孤児のときだけ消す（レビュー指摘 2026-09-17）。
 *
 * @returns 消したなら true、台帳に戻っていて取りやめたなら false
 */
export async function purgeIfStillOrphan(
  prisma: PrismaService,
  workspaceId: string,
  docId: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const meta = await tx.docMeta.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
      select: { docId: true },
    });
    if (meta) return false;

    const where = { workspaceId, docId };
    // ⚠️ 台帳の行は無いので、ここでは触らない。
    // 版数も上げない（一覧の中身は変わらないため）
    await tx.docUpdate.deleteMany({ where });
    await tx.docSnapshot.deleteMany({ where });
    await tx.docHistory.deleteMany({ where });
    await tx.searchIndex.deleteMany({ where });
    await tx.searchIndexQueue.deleteMany({ where });
    return true;
  });
}

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaService();

  console.log(
    apply
      ? '⚠️ 実行モード: 孤児を消します'
      : '下見: 何も書き換えません（--apply で実行）',
  );

  try {
    const orphans = await findOrphans(prisma);

    let docs = 0;
    let rows = 0;
    let skipped = 0;

    for (const [workspaceId, docIds] of orphans) {
      for (const docId of docIds) {
        docs++;

        const where = { workspaceId, docId };
        const [updateCount, snapshotCount, historyCount, indexCount] =
          await Promise.all([
            prisma.docUpdate.count({ where }),
            prisma.docSnapshot.count({ where }),
            prisma.docHistory.count({ where }),
            prisma.searchIndex.count({ where }),
          ]);
        rows += updateCount + snapshotCount + historyCount + indexCount;

        console.log(
          `${apply ? '削除' : '対象'} ${workspaceId}/${docId} ` +
            `本文${updateCount} 圧縮${snapshotCount} ` +
            `履歴${historyCount} 索引${indexCount}`,
        );

        if (!apply) continue;

        const purged = await purgeIfStillOrphan(prisma, workspaceId, docId);
        if (!purged) {
          console.log(`  → 取りやめ: 台帳に戻っていました（${docId}）`);
          skipped++;
        }
      }
    }

    console.log(`\nページ ${docs} 件 / 行 ${rows} 件`);
    if (skipped > 0) {
      console.log(`うち ${skipped} 件は、途中で台帳に戻ったため消していません`);
    }
    if (!apply && docs > 0) {
      console.log('消すには --apply を付けて実行してください');
    }
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

// ⚠️ 直接実行したときだけ走らせる。
// そうしないと、検査から読み込んだだけで本番の掃除が始まる
if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
