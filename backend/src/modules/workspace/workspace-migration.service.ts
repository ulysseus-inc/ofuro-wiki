import { PrismaService } from '../../prisma.service';
import { AuditService } from '../audit/audit.service';
import { AdminService } from '../admin/admin.service';
import { getAdminEmail } from '../../common/admin-email';
import { WorkspaceKind } from '../../common/workspace-kind';
import { IndexReaderService } from '../discovery/index-reader.service';

/** 1 人 1 つのプライベートを DB で強制する一意インデックス（docs/workspace-model.md 12.9） */
export const ONE_PRIVATE_INDEX = 'workspaces_one_private_per_owner';

/** 移行での扱い（docs/workspace-model.md 12.9 の表） */
export enum MigrationDecision {
  /** 持ち主のほかに参加者が居る（または --share で選んだ） → 共有にする */
  Shared = 'shared',
  /** 持ち主だけ → プライベートのまま */
  Private = 'private',
  /** 1 人が「持ち主だけ」のものを 2 つ以上持つ → 書き換えず、人が決める */
  Review = 'review',
  /** すでに共有 → 何もしない（2 回目以降） */
  Done = 'done',
}

export interface MigrationPlanItem {
  id: string;
  name: string | null;
  ownerId: string;
  ownerEmail: string;
  /** 持ち主以外の参加済みのメンバーの数 */
  otherMembers: number;
  decision: MigrationDecision;
}

export interface MigrationResult {
  plan: MigrationPlanItem[];
  /** 共有に変えた数 */
  converted: number;
  /** 書き換えずに残した要判断 */
  review: MigrationPlanItem[];
  /** 1 人 1 つの一意インデックス */
  uniqueIndex: 'created' | 'exists' | 'blocked';
}

/**
 * #297: 一回限りの移行ツールの判断（docs/workspace-model.md 12.9）。
 * スクリプト（`src/scripts/migrate-workspace-kind.ts`）は薄くし、判断はここに置く。
 *
 * ```
 * plan()   下見。何も書き換えずに、ワークスペースごとの扱いを返す
 * apply()  共有にするものの種類を変え、持ち主を root に付け替え、1 人 1 つを DB で強制する
 * ```
 *
 * ⚠️ **何度流しても同じ結果になること。** 共有にしたものは次から「済み」になる。
 */
export class WorkspaceMigrationService {
  constructor(
    private prisma: PrismaService,
    private admin: Pick<AdminService, 'reassignSharedOwner'>,
    private audit: Pick<AuditService, 'record'>,
    // #319: 名前はルート文書が正（DB の workspaces.name は作った時のまま）
    private names: Pick<IndexReaderService, 'workspaceName'>,
  ) {}

  /** 下見。`share` は、要判断のうち共有にするもの（--share） */
  async plan(share: Set<string> = new Set()): Promise<MigrationPlanItem[]> {
    const workspaces = await this.prisma.workspace.findMany({
      select: {
        id: true,
        name: true,
        kind: true,
        ownerId: true,
        owner: { select: { email: true } },
        members: { where: { status: 'accepted' }, select: { userId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // #319: 名前はルート文書から読む（DB はほぼ ofuro-wiki のままで、一覧から見分けられない）
    const names = await Promise.all(workspaces.map((w) => this.names.workspaceName(w)));
    const items = workspaces.map((w, i) => ({
      id: w.id,
      name: names[i],
      kind: w.kind,
      ownerId: w.ownerId,
      ownerEmail: w.owner.email,
      otherMembers: w.members.filter((m) => m.userId !== w.ownerId).length,
    }));

    // 持ち主ごとに、選ばれていない「持ち主だけ」のものを数える（2 つ以上なら要判断）
    const soloCount = new Map<string, number>();
    for (const it of items) {
      if (isSolo(it) && !share.has(it.id)) {
        soloCount.set(it.ownerId, (soloCount.get(it.ownerId) ?? 0) + 1);
      }
    }

    return items.map(({ kind, ...it }) => ({
      ...it,
      decision: decide({ ...it, kind }, share, soloCount.get(it.ownerId) ?? 0),
    }));
  }

  /** root（ROOT_EMAIL のユーザー）。居なければ null（共有の持ち主が決まらない） */
  async findRoot() {
    const rootEmail = getAdminEmail();
    return rootEmail ? this.prisma.user.findUnique({ where: { email: rootEmail } }) : null;
  }

  /**
   * `--share` に渡せるのは、プライベートか要判断になるもの。打ち間違い・
   * もともと共有になるものを返す（空なら問題なし）。
   * すでに共有のもの（済み）は渡してよい（何もしない）。途中で失敗したあと、同じ引数で流し直すため
   */
  async invalidShare(share: Set<string>): Promise<string[]> {
    if (share.size === 0) {
      return [];
    }
    const base = new Map((await this.plan()).map((p) => [p.id, p.decision]));
    const allowed = new Set([
      MigrationDecision.Private,
      MigrationDecision.Review,
      MigrationDecision.Done,
    ]);
    return [...share].filter((id) => !allowed.has(base.get(id) as MigrationDecision));
  }

  /**
   * 書き換える。root が居ない・`--share` が正しくないときは、何も書き換えずに止める。
   *
   * ⚠️ 途中で失敗しても、そのまま流し直せば直る。共有にしたものは次から「済み」になり、
   * 持ち主の付け替え（reassignSharedOwner）は毎回すべての共有を見直すため
   */
  async apply(share: Set<string> = new Set()): Promise<MigrationResult> {
    const invalid = await this.invalidShare(share);
    if (invalid.length > 0) {
      throw new Error(
        `--share に渡せるのは、プライベートか要判断になるものだけです（下見で確かめてください）: ${invalid.join(', ')}`,
      );
    }
    const root = await this.findRoot();
    if (!root) {
      throw new Error(
        'root（ROOT_EMAIL のユーザー）が居ないため、共有の持ち主が決まりません。root でサインインしてから流してください',
      );
    }

    const plan = await this.plan(share);
    const toShare = plan.filter((p) => p.decision === MigrationDecision.Shared);

    for (const item of toShare) {
      // ⚠️ 記録を先に書く。種類を変えた後で落ちると、次は「済み」になって記録が二度と残らない。
      // 先に書けば、落ちても流し直したときにもう一度記録されるだけ（重複はしうるが、欠けない）
      await this.audit.record({
        action: 'workspace.kind.migrate',
        actor: { email: 'system' },
        targetType: 'workspace',
        targetId: item.id,
        targetName: item.name ?? undefined,
        workspaceId: item.id,
        detail: {
          meta: { to: WorkspaceKind.Shared, owner: item.ownerEmail, otherMembers: item.otherMembers },
        },
      });
      await this.prisma.workspace.update({
        where: { id: item.id },
        data: { kind: WorkspaceKind.Shared },
      });
    }

    // 持ち主を root に付け替える（12.7 と同じ処理。元の持ち主はワークスペース管理者になる）
    await this.admin.reassignSharedOwner(root.id);

    return {
      plan,
      converted: toShare.length,
      review: plan.filter((p) => p.decision === MigrationDecision.Review),
      uniqueIndex: await this.ensureOnePrivateIndex(),
    };
  }

  /**
   * 1 人 1 つを DB で強制する。重複が残っていれば作らない（作ろうとすると失敗する）。
   * マイグレーションが作れなかった環境のために、移行の最後にもう一度試す
   */
  private async ensureOnePrivateIndex(): Promise<MigrationResult['uniqueIndex']> {
    const duplicates = await this.prisma.$queryRaw<{ owner_id: string }[]>`
      SELECT owner_id FROM workspaces WHERE kind = ${WorkspaceKind.Private}
      GROUP BY owner_id HAVING count(*) > 1`;
    if (duplicates.length > 0) {
      return 'blocked';
    }
    // ⚠️ CREATE ... IF NOT EXISTS の戻り値では「作った」と「もうあった」を区別できない。先に確かめる
    const existing = await this.prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'workspaces' AND indexname = ${ONE_PRIVATE_INDEX}`;
    if (existing.length > 0) {
      return 'exists';
    }
    await this.prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${ONE_PRIVATE_INDEX}" ON "workspaces" ("owner_id") WHERE "kind" = '${WorkspaceKind.Private}'`,
    );
    return 'created';
  }
}

function isSolo(it: { id: string; kind: string; otherMembers: number }): boolean {
  return it.kind !== WorkspaceKind.Shared && it.otherMembers === 0;
}

function decide(
  it: { id: string; kind: string; otherMembers: number },
  share: Set<string>,
  soloOfOwner: number,
): MigrationDecision {
  if (it.kind === WorkspaceKind.Shared) {
    return MigrationDecision.Done;
  }
  if (it.otherMembers > 0 || share.has(it.id)) {
    return MigrationDecision.Shared;
  }
  return soloOfOwner >= 2 ? MigrationDecision.Review : MigrationDecision.Private;
}
