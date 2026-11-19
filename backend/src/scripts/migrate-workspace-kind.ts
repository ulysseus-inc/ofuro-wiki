/**
 * #297: 既存のワークスペースを、プライベートと共有に振り分ける（一回限り）。
 *
 * ```
 * # 下見（既定・何も書き換えない）
 * node dist/src/scripts/migrate-workspace-kind.js
 *
 * # 書き換える
 * node dist/src/scripts/migrate-workspace-kind.js --apply
 *
 * # 要判断のうち、共有にするものを選んで書き換える
 * node dist/src/scripts/migrate-workspace-kind.js --apply --share <ID>,<ID>
 * ```
 *
 * ⚠️ **既定は下見。** `--apply` を付けたときだけ書き換える。
 * ⚠️ **流す前にバックアップを取る。** 戻し方は「流す直前のバックアップからリストア」。
 * ⚠️ **`src/` の下に置くこと。** 本番イメージには `dist/` と `node_modules` しか無い。
 *
 * 詳細は docs/workspace-model.md 12.9
 */
import 'dotenv/config';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../modules/audit/audit.service';
import { AdminService } from '../modules/admin/admin.service';
import { DiscoveryRevisionService } from '../modules/discovery/discovery-revision.service';
import { IndexReaderService } from '../modules/discovery/index-reader.service';
import {
  MigrationDecision,
  MigrationPlanItem,
  WorkspaceMigrationService,
} from '../modules/workspace/workspace-migration.service';
import { DocViewRecorder } from '../modules/audit/doc-view-recorder';

const LABELS: Record<MigrationDecision, string> = {
  [MigrationDecision.Shared]: '共有にする',
  [MigrationDecision.Private]: 'プライベート',
  [MigrationDecision.Review]: '★要判断',
  [MigrationDecision.Done]: '済み（共有）',
};

/** `--share a,b` を集合にする */
function parseShare(argv: string[]): Set<string> {
  const i = argv.indexOf('--share');
  if (i < 0) {
    return new Set();
  }
  // `--share --apply` のように ID を書き忘れたとき、次の指定を ID と取り違えない
  if (!argv[i + 1] || argv[i + 1].startsWith('--')) {
    throw new Error('--share の後ろに、共有にするワークスペースの ID を書いてください（カンマ区切り）');
  }
  return new Set(argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean));
}

function line(p: MigrationPlanItem): string {
  return (
    `${LABELS[p.decision].padEnd(8)} ${p.id}  ${p.name ?? '(名前なし)'}` +
    `  持ち主: ${p.ownerEmail}  ほかの参加者: ${p.otherMembers}`
  );
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const names = new IndexReaderService(prisma);
  const admin = new AdminService(
    prisma,
    audit,
    new DiscoveryRevisionService(prisma),
    names,
    new DocViewRecorder(prisma, audit),
  );
  const migration = new WorkspaceMigrationService(prisma, admin, audit, names);

  console.log(apply ? '⚠️ 実行モード: 書き換えます' : '下見: 何も書き換えません（--apply で実行）');

  try {
    const share = parseShare(argv);
    if (!(await migration.findRoot())) {
      console.log('⚠️ root（ROOT_EMAIL のユーザー）が居ません。--apply は止まります。root でサインインしてから流してください');
    }
    if (!apply) {
      const invalid = await migration.invalidShare(share);
      if (invalid.length > 0) {
        console.log(`⚠️ --share に渡せない ID があります（--apply は止まります）: ${invalid.join(', ')}`);
      }
      const plan = await migration.plan(share);
      plan.forEach((p) => console.log(line(p)));
      summarize(plan);
      return 0;
    }

    const result = await migration.apply(share);
    result.plan.forEach((p) => console.log(line(p)));
    summarize(result.plan);
    console.log(`共有に変えた: ${result.converted} 件`);
    console.log(
      {
        created: '1 人 1 つの一意インデックスを作りました',
        exists: '1 人 1 つの一意インデックスは、すでにあります',
        blocked: `⚠️ 要判断が残っているため、1 人 1 つの一意インデックスは作っていません（${result.review.length} 件）。--share で共有にするか、まとめてから、もう一度流してください`,
      }[result.uniqueIndex],
    );
    return result.uniqueIndex === 'blocked' ? 2 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

function summarize(plan: MigrationPlanItem[]) {
  const count = (d: MigrationDecision) => plan.filter((p) => p.decision === d).length;
  console.log(
    `--- 合計 ${plan.length} 件: ` +
      Object.values(MigrationDecision)
        .map((d) => `${LABELS[d]} ${count(d)}`)
        .join(' / '),
  );
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`移行に失敗しました: ${(e as Error).message}`);
    process.exit(1);
  });
