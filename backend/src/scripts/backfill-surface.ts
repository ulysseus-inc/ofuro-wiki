/**
 * #250: **すでに保存されているページに surface を足す。**
 *
 * ```
 * # 下見（既定・何も書き換えない）
 * node dist/src/scripts/backfill-surface.js
 *
 * # 実行
 * node dist/src/scripts/backfill-surface.js --apply
 * ```
 *
 * 内部API（`/api/internal/docs/upsert`）で作ったページには
 * `affine:surface` が無く、**エッジレスモードで開くと真っ白になって落ちる**。
 * 組み立て側は直したが、すでに保存済みのページは直らないため、ここで補う。
 *
 * ⚠️ **既存の内容には触らない。** CRDT の差分を1つ足すだけで、
 * 本文・題・履歴はそのまま残る。二重に流しても増えない（surface があれば何もしない）。
 *
 * ⚠️ **既定は下見。** `--apply` を付けたときだけ書き込む。
 * ⚠️ **本番で流す前にバックアップを取る**（docs/backup.md）。
 */
import 'dotenv/config';
import * as Y from 'yjs';
import { PrismaService } from '../prisma.service';
import { surfaceBackfillUpdate } from '../modules/doc/yjs-doc-builder';
import { isUserDoc } from '../modules/sync/user-doc';

/** その doc の現在の状態を組み立てる。 */
async function loadDoc(
  prisma: PrismaService,
  workspaceId: string,
  docId: string,
): Promise<Y.Doc | null> {
  const [snapshots, updates] = await Promise.all([
    prisma.docSnapshot.findMany({ where: { workspaceId, docId } }),
    prisma.docUpdate.findMany({
      where: { workspaceId, docId },
      orderBy: { timestamp: 'asc' },
    }),
  ]);
  if (snapshots.length === 0 && updates.length === 0) return null;

  const doc = new Y.Doc();
  for (const row of [...snapshots, ...updates]) {
    try {
      Y.applyUpdate(doc, new Uint8Array(row.blob));
    } catch {
      // 壊れた断片は飛ばす。1つ読めなくても他で状態は作れる
    }
  }
  return doc;
}

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaService();

  console.log(
    apply
      ? '⚠️ 実行モード: surface を書き足します'
      : '下見: 何も書き換えません（--apply で実行）',
  );

  try {
    const metas = await prisma.docMeta.findMany({
      where: { trash: false },
      select: { workspaceId: true, docId: true, title: true },
    });

    let need = 0;
    let done = 0;
    let skipped = 0;

    for (const meta of metas) {
      const { workspaceId, docId } = meta;
      if (!isUserDoc(workspaceId, docId)) continue;

      const doc = await loadDoc(prisma, workspaceId, docId);
      if (!doc) {
        skipped++;
        continue;
      }

      const update = surfaceBackfillUpdate(doc);
      if (!update) continue;

      need++;
      console.log(
        `${apply ? '補正' : '対象'} ${workspaceId}/${docId} ${meta.title ?? ''}`,
      );
      if (!apply) continue;

      // ⚠️ 差分を1行足すだけ。既存の行は書き換えない
      await prisma.docUpdate.create({
        data: { workspaceId, docId, blob: Buffer.from(update) },
      });
      done++;
    }

    console.log(
      `\n検査 ${metas.length} 件 / 要補正 ${need} 件` +
        (apply ? ` / 補正済み ${done} 件` : '') +
        (skipped ? ` / 本文なし ${skipped} 件` : ''),
    );
    if (!apply && need > 0) {
      console.log('補正するには --apply を付けて実行してください');
    }
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

// ⚠️ 直接実行したときだけ走らせる（検査から読み込んだだけで走らせない）
if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
