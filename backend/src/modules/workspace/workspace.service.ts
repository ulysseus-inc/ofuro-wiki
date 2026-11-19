import { Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { DiscoveryRevisionService } from '../discovery/discovery-revision.service';
import { InviteOutcome } from './workspace.model';
import { getAdminEmail } from '../../common/admin-email';
import {
  WorkspaceKind,
  systemAdminBypasses,
} from '../../common/workspace-kind';
// #148: 招待の受諾は種別ごとに扱いが違う。判定は1か所に置く
import {
  EMAIL_INVITE_TTL_MS,
  INVITE_LINK_EMAIL,
  judgeInvitation,
} from './invitation-rule';

import { IndexReaderService } from '../discovery/index-reader.service';
@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private audit: AuditService,
    // #151: メンバーの増減・ロール変更で「誰に何が見えるか」が変わる
    private discovery: DiscoveryRevisionService,
    // #319: 名前はルート文書が正（DB の workspaces.name は作った時のまま）。
    // ⚠️ 型は IndexReaderService のまま書く。Pick<…> にすると Nest が注入できず、起動しない
    private names: IndexReaderService,
  ) {}

  /**
   * #297: ワークスペースを作る（docs/workspace-model.md 12.3）。
   *
   * | 種類 | 作れる人 | 持ち主 |
   * |---|---|---|
   * | private | プライベートをまだ持たない人（最初のサインイン） | 本人 |
   * | shared | システム管理者だけ | root（ROOT_EMAIL） |
   */
  async createWorkspace(
    userId: string,
    name?: string,
    kind: WorkspaceKind = WorkspaceKind.Private,
  ) {
    if (kind === WorkspaceKind.Shared) {
      return this.createSharedWorkspace(userId, name);
    }

    const owned = await this.prisma.workspace.count({
      where: { ownerId: userId, kind: WorkspaceKind.Private },
    });
    if (owned > 0) {
      throw new ForbiddenException('A private workspace already exists');
    }
    try {
      return await this.insertWorkspace(userId, name, WorkspaceKind.Private);
    } catch (e) {
      // 同時の要求で 2 つ目を作ろうとすると、1 人 1 つの一意インデックスが断る（12.9）
      if (isOnePrivateViolation(e)) {
        throw new ForbiddenException('A private workspace already exists');
      }
      throw e;
    }
  }

  private async createSharedWorkspace(userId: string, name?: string) {
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });
    if (!actor?.isAdmin) {
      throw new ForbiddenException('Only system admins can create shared workspaces');
    }

    // 持ち主は root。root が居ないと共有の持ち主が決まらない（最初のサインインの前）
    const root = await this.findRootUser();
    if (!root) {
      throw new ForbiddenException('The root user (ROOT_EMAIL) has not signed in yet');
    }
    return this.insertWorkspace(root.id, name, WorkspaceKind.Shared);
  }

  /** 持ち主を owner のメンバーとして入れて作る */
  private async insertWorkspace(
    ownerId: string,
    name: string | undefined,
    kind: WorkspaceKind,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: name || 'ofuro-wiki',
          ownerId,
          kind,
        },
      });
      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: ownerId,
          role: 'owner',
          status: 'accepted',
        },
      });
      return workspace;
    });
  }

  /** #297: 自分が持ち主のプライベートの ID。無ければ null（1 人 1 つ） */
  async findPrivateWorkspaceId(userId: string): Promise<string | null> {
    const ws = await this.prisma.workspace.findFirst({
      where: { ownerId: userId, kind: WorkspaceKind.Private },
      select: { id: true },
    });
    return ws?.id ?? null;
  }

  /** #297: root（`.env` の ROOT_EMAIL のユーザー）。まだサインインしていなければ null */
  async findRootUser() {
    const email = getAdminEmail();
    if (!email) {
      return null;
    }
    return this.prisma.user.findUnique({ where: { email } });
  }

  /**
   * #297: その人のワークスペースでの実効の役割（12.2）。
   * 共有では、システム管理者は owner と同じに扱う。それ以外はメンバーの役割。
   *
   * ⚠️ **素通りをメンバーの役割より先に見る。** 逆にすると、システム管理者がその共有に
   * メンバーやワークスペース管理者として入っているとき、その役割に下がってしまう
   * （PR #311 のレビューで発見。入口のガード・ページの権限も素通りが先）。
   */
  async effectiveRole(workspaceId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });
    if (user?.isAdmin) {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { kind: true },
      });
      if (systemAdminBypasses(user.isAdmin, workspace?.kind)) {
        return 'owner';
      }
    }
    return this.getMemberRole(workspaceId, userId);
  }

  /**
   * #297: ワークスペース管理者（admin）を下げる・外すのは、持ち主（root）とシステム管理者だけ（12.4）。
   * 任命と同じ立場に揃える。ワークスペース管理者どうしで外し合えないように
   */
  private async assertCanTouchManager(workspaceId: string, targetId: string, actorId: string) {
    const target = await this.getMemberRole(workspaceId, targetId);
    if (target !== 'admin') {
      return;
    }
    const actor = await this.effectiveRole(workspaceId, actorId);
    if (actor !== 'owner') {
      throw new ForbiddenException('Only system admins can change or remove workspace admins');
    }
  }

  /** #297: プライベートには招待できない（12.4） */
  private async assertInvitable(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { kind: true },
    });
    if (workspace?.kind !== WorkspaceKind.Shared) {
      throw new ForbiddenException('Private workspaces cannot have other members');
    }
  }

  async deleteWorkspace(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    // #90: 画面・CSV・絞り込みはすべて actorEmail を見る。
    // id だけ渡すと actorEmail が 'anonymous' になり、実行者を追えない
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, isAdmin: true },
    });
    // #297: 共有はシステム管理者だけ。プライベートは本人だけ（消すと、次のサインインで作り直される）
    const canDelete =
      workspace.kind === WorkspaceKind.Shared
        ? systemAdminBypasses(actor?.isAdmin, workspace.kind)
        : workspace.ownerId === userId;
    if (!canDelete) {
      throw new ForbiddenException('Not allowed to delete this workspace');
    }
    // #319: 名前はルート文書から読む。ルート文書も一緒に消えるので、消す前に読む
    const name = await this.names.workspaceName(workspace);
    await this.prisma.workspace.delete({ where: { id: workspaceId } });

    // #90: 名前は**消す前にしか取れない**。UUID だけ残しても、
    // 参照先が消えているため後から何を消したのか分からない。
    await this.audit.record({
      action: 'workspace.delete',
      actor: { id: userId, email: actor?.email, name: actor?.name },
      targetType: 'workspace',
      targetId: workspaceId,
      targetName: name ?? undefined,
      workspaceId,
    });
    return true;
  }

  async getWorkspace(workspaceId: string) {
    return this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { members: { include: { user: true } } },
    });
  }

  async getUserWorkspaces(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, status: 'accepted' },
      include: {
        workspace: {
          include: { members: { include: { user: true } } },
        },
      },
    });
    const joined = memberships.map((m) => ({
      workspace: m.workspace,
      role: m.role,
    }));

    // #297: システム管理者の一覧には、メンバーでない共有も載せる（12.8）。
    // 画面は一覧に載ったものしか開けないため、載せないと素通りがあっても管理できない。
    // 役割は持ち主と同じ扱い（素通り）。マニュアルはメンバーとしての扱いのまま
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });
    if (!user?.isAdmin) {
      return joined;
    }
    // ⚠️ 入っている共有も、役割は持ち主と同じ扱い（effectiveRole と揃える）
    const asAdmin = joined.map((j) =>
      systemAdminBypasses(user.isAdmin, j.workspace.kind)
        ? { ...j, role: 'owner' }
        : j,
    );
    const others = await this.prisma.workspace.findMany({
      where: {
        kind: WorkspaceKind.Shared,
        id: { notIn: memberships.map((m) => m.workspaceId) },
      },
      include: { members: { include: { user: true } } },
    });
    return [
      ...asAdmin,
      ...others.map((w) => ({ workspace: w, role: 'owner' })),
    ];
  }

  async getMemberRole(workspaceId: string, userId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
    });
    return member?.role ?? null;
  }

  async inviteByEmail(
    workspaceId: string,
    inviterId: string,
    email: string,
    role = 'member',
  ) {
    await this.assertInvitable(workspaceId);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const outcome = await this.inviteOutcomeOf(workspaceId, user?.id);

    const invitation = await this.prisma.invitation.create({
      data: {
        workspaceId,
        inviterId,
        email,
        role,
        // #148: 期限を入れる（招待リンクの既定と揃えて7日）。
        // ⚠️ 既存の行は `null` のまま＝期限なしとして通す。
        // 期限切れ扱いにすると、**いま出ている招待を黙って無効化する**
        expireTime: new Date(Date.now() + EMAIL_INVITE_TTL_MS),
      },
    });

    // If user exists, auto-add as member
    if (user) {
      await this.prisma.workspaceMember.upsert({
        where: {
          workspaceId_userId: { workspaceId, userId: user.id },
        },
        create: {
          workspaceId,
          userId: user.id,
          role,
          status: 'accepted',
        },
        update: {},
      });
    }

    // Send invitation email (non-blocking, failures don't affect invitation)
    let sentSuccess = false;
    // #299: すでにメンバーの人に招待メールを送らない（招待の行は既存の受諾経路のため今までどおり作る）
    if (outcome !== InviteOutcome.AlreadyMember && this.mailService.isEnabled()) {
      try {
        const inviter = await this.prisma.user.findUnique({
          where: { id: inviterId },
        });
        const workspace = await this.prisma.workspace.findUnique({
          where: { id: workspaceId },
        });
        const name = workspace ? await this.names.workspaceName(workspace) : null;
        await this.mailService.sendInvitationEmail(
          inviter?.name || inviter?.email || 'Unknown',
          email,
          name || 'Workspace',
          invitation.id,
        );
        sentSuccess = true;
      } catch (err) {
        this.logger.warn(`Failed to send invitation email to ${email}: ${err}`);
      }
    }

    return { ...invitation, sentSuccess, outcome };
  }

  /** #299: 招待の前に、宛先がどうなるかを決める（追加・すでにメンバー・招待だけ） */
  private async inviteOutcomeOf(
    workspaceId: string,
    userId: string | undefined,
  ): Promise<InviteOutcome> {
    if (!userId) {
      return InviteOutcome.Invited;
    }

    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    return member ? InviteOutcome.AlreadyMember : InviteOutcome.Added;
  }

  async removeMember(workspaceId: string, userId: string, actorId: string) {
    // #297: 持ち主（共有では root）は外させない。外すと持ち主が居なくなる
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    });
    if (workspace?.ownerId === userId) {
      throw new ForbiddenException('The owner cannot be removed');
    }
    await this.assertCanTouchManager(workspaceId, userId, actorId);
    await this.prisma.workspaceMember.delete({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
    });
    // ⚠️ #151: 誰に何が見えるかが変わる。**書き込んだあと**に上げる
    await this.discovery.bump(workspaceId, 'permission-workspace');
    return true;
  }

  async getMembers(
    workspaceId: string,
    skip = 0,
    take = 20,
    query?: string,
  ) {
    const where: any = { workspaceId };
    if (query) {
      where.user = {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
      };
    }
    return this.prisma.workspaceMember.findMany({
      where,
      include: { user: true },
      skip,
      take,
      orderBy: { createdAt: 'asc' },
    });
  }

  async getMemberCount(workspaceId: string) {
    return this.prisma.workspaceMember.count({ where: { workspaceId } });
  }

  /**
   * 招待を受諾する。
   *
   * ⚠️ **招待は2種類あり、扱いが違う**（docs/workspace-invitation.md）。
   * 判定は `judgeInvitation` に委ねること。ここに条件を書き足さない。
   *
   * ⚠️ 以前は**招待 ID だけ**で受諾でき、宛先も期限も見ていなかった。
   * リンクを転送されれば**招待していない人がワークスペースに入れた**（#148）。
   */
  async acceptInvite(workspaceId: string, inviteId: string, userId: string) {
    await this.assertInvitable(workspaceId);
    const [invitation, user] = await Promise.all([
      this.prisma.invitation.findUnique({ where: { id: inviteId } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      }),
    ]);

    // ⚠️ 判定と消費で**同じ時刻**を使う。別々に取ると、境目で
    // 「判定は通ったのに消費で期限切れ」という説明できない失敗が出る
    const now = new Date();
    const judgement = judgeInvitation({
      invitation,
      user: { email: user?.email ?? null },
      workspaceId,
      now,
    });

    if (!judgement.ok) {
      // ⚠️ **理由で応答を分けない。** 「宛先が違う」と「無い」を区別すると、
      // 招待の**存在を確かめる手段**になる。記録には理由を残す
      this.logger.warn(
        `Invitation rejected: ${judgement.reason} (invite=${inviteId} user=${userId})`,
      );
      throw new NotFoundException('Invitation not found');
    }

    // ⚠️ **消費とメンバー追加は同じトランザクションで、消費を先に行う。**
    //
    // 分けると、削除に失敗しても受諾が成功する。招待は残ったままなので
    // **退出させたあとに同じリンクで戻れる**——「一度だけ」という
    // 認可上の約束が、障害時に静かに破れる（Codex 指摘・2026-09-05）。
    //
    // ⚠️ **削除そのものを検査に使う**（読んでから消すのではなく）。
    // 削除できた1件だけが受諾できるので、**同時受諾も片方だけが通る**。
    const consumed = await this.prisma.$transaction(async (tx) => {
      if (judgement.consume) {
        // ⚠️ 条件を全部入れること。id だけで消すと、別ワークスペースの
        // 招待や期限切れを掴んだまま消してしまう
        const result = await tx.invitation.deleteMany({
          where: {
            id: inviteId,
            workspaceId,
            email: judgement.invitation.email,
            OR: [{ expireTime: null }, { expireTime: { gt: now } }],
          },
        });
        // 消せなかった＝他の誰か（別タブ・再送）が先に使い切った
        if (result.count !== 1) return false;
      } else {
        // 招待リンクは消さない（再利用が仕様）。
        // ⚠️ それでも**この瞬間に有効か**は確かめる。判定してから
        // ここへ来るまでに失効・取り消しが起こり得る
        const alive = await tx.invitation.count({
          where: {
            id: inviteId,
            workspaceId,
            OR: [{ expireTime: null }, { expireTime: { gt: now } }],
          },
        });
        if (alive !== 1) return false;
      }

      await tx.workspaceMember.upsert({
        where: {
          workspaceId_userId: { workspaceId, userId },
        },
        create: {
          workspaceId,
          userId,
          role: judgement.invitation.role,
          status: 'accepted',
        },
        update: { status: 'accepted' },
      });
      return true;
    });

    if (!consumed) {
      this.logger.warn(
        `Invitation already consumed or revoked (invite=${inviteId} user=${userId})`,
      );
      throw new NotFoundException('Invitation not found');
    }

    // ⚠️ #151: 誰に何が見えるかが変わる。**書き込んだあと**に上げる
    await this.discovery.bump(workspaceId, 'permission-workspace');
    return true;
  }

  async leaveWorkspace(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (workspace.ownerId === userId) {
      throw new ForbiddenException('Owner cannot leave workspace');
    }
    // #297: メンバーでない人（素通りで入っているシステム管理者など）は抜けられない。行が無いと削除が失敗して 500 になる
    if (!(await this.getMemberRole(workspaceId, userId))) {
      throw new ForbiddenException('Not a member of this workspace');
    }
    await this.prisma.workspaceMember.delete({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
    });
    // ⚠️ #151: 誰に何が見えるかが変わる。**書き込んだあと**に上げる
    await this.discovery.bump(workspaceId, 'permission-workspace');
    return true;
  }

  async grantMember(
    workspaceId: string,
    userId: string,
    permission: string,
    currentUserId: string,
  ) {
    // #297: システム管理者はメンバーでなくても共有の役割を変えられる（12.4）
    const currentRole = await this.effectiveRole(workspaceId, currentUserId);
    if (currentRole !== 'owner' && currentRole !== 'admin') {
      throw new ForbiddenException('Only owner or admin can change roles');
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true, kind: true },
    });
    // 持ち主（共有では root）の役割は変えさせない。下げると持ち主が居なくなる
    if (workspace?.ownerId === userId) {
      throw new ForbiddenException("The owner's role cannot be changed");
    }
    await this.assertCanTouchManager(workspaceId, userId, currentUserId);

    const roleMap: Record<string, string> = {
      Owner: 'owner',
      Admin: 'admin',
      Write: 'member',
      Read: 'reader',
    };
    const newRole = roleMap[permission] ?? 'member';

    // #297: ワークスペース管理者を選べるのは、持ち主（root）とシステム管理者だけ
    if (newRole === 'admin' && currentRole !== 'owner') {
      throw new ForbiddenException('Only system admins can appoint workspace admins');
    }

    if (newRole === 'owner') {
      // #297: 共有の持ち主は root に固定（12.4）
      if (workspace?.kind === WorkspaceKind.Shared) {
        throw new ForbiddenException('The owner of a shared workspace is fixed to root');
      }
      // Transfer ownership
      if (currentRole !== 'owner') {
        throw new ForbiddenException('Only owner can transfer ownership');
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.workspace.update({
          where: { id: workspaceId },
          data: { ownerId: userId },
        });
        await tx.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId, userId } },
          data: { role: 'owner' },
        });
        await tx.workspaceMember.update({
          where: {
            workspaceId_userId: { workspaceId, userId: currentUserId },
          },
          data: { role: 'admin' },
        });
      });
    } else {
      await this.prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId } },
        data: { role: newRole },
      });
    }
    // ⚠️ #151: 誰に何が見えるかが変わる。**書き込んだあと**に上げる
    await this.discovery.bump(workspaceId, 'permission-workspace');
    return true;
  }

  async getInviteInfo(inviteId: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: inviteId },
      include: {
        workspace: true,
        inviter: true,
      },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');

    const invitee = invitation.email
      ? await this.prisma.user.findUnique({
          where: { email: invitation.email },
        })
      : null;

    const member = invitee
      ? await this.prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: invitation.workspaceId,
              userId: invitee.id,
            },
          },
        })
      : null;

    return {
      workspace: {
        id: invitation.workspace.id,
        name: (await this.names.workspaceName(invitation.workspace)) || 'Workspace',
        avatar: invitation.workspace.avatarKey ?? '',
      },
      user: {
        id: invitation.inviter.id,
        name: invitation.inviter.name,
        avatarUrl: invitation.inviter.avatarUrl,
      },
      invitee: invitee
        ? {
            id: invitee.id,
            name: invitee.name,
            email: invitee.email,
            avatarUrl: invitee.avatarUrl,
          }
        : { id: '', name: '', email: invitation.email, avatarUrl: null },
      status: member?.status === 'accepted' ? 'Accepted' : 'Pending',
    };
  }

  async createInviteLink(
    workspaceId: string,
    expireTime: string,
    inviterId: string,
  ) {
    await this.assertInvitable(workspaceId);
    const expireMs: Record<string, number> = {
      OneDay: 24 * 60 * 60 * 1000,
      ThreeDays: 3 * 24 * 60 * 60 * 1000,
      OneWeek: 7 * 24 * 60 * 60 * 1000,
      OneMonth: 30 * 24 * 60 * 60 * 1000,
    };
    const ms = expireMs[expireTime] ?? expireMs.OneWeek;
    const expireAt = new Date(Date.now() + ms);

    // ワークスペースごとに招待リンクは1つだけ保持する（既存リンクは作り直す）
    await this.prisma.invitation.deleteMany({
      where: { workspaceId, email: INVITE_LINK_EMAIL },
    });

    // Store as a special invitation with email='__invite_link__'
    const invitation = await this.prisma.invitation.create({
      data: {
        workspaceId,
        inviterId, // 招待リンクを生成したユーザー（外部キー制約のため実在ユーザーが必要）
        email: INVITE_LINK_EMAIL,
        role: 'member',
        expireTime: expireAt,
      },
    });

    return {
      link: this.buildInviteLinkUrl(invitation.id),
      expireTime: expireAt,
    };
  }

  async revokeInviteLink(workspaceId: string) {
    await this.prisma.invitation.deleteMany({
      where: { workspaceId, email: INVITE_LINK_EMAIL },
    });
    return true;
  }

  // 現在有効な招待リンクを返す（表示用）。無ければ null。
  async getActiveInviteLink(workspaceId: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: {
        workspaceId,
        email: INVITE_LINK_EMAIL,
        OR: [{ expireTime: null }, { expireTime: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!invitation) {
      return null;
    }
    return {
      link: this.buildInviteLinkUrl(invitation.id),
      expireTime: invitation.expireTime,
    };
  }

  private buildInviteLinkUrl(inviteId: string) {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3010';
    return `${baseUrl}/invite/${inviteId}`;
  }
}

/**
 * 1 人 1 つのプライベートの一意インデックス（workspaces_one_private_per_owner）に違反したか。
 *
 * ⚠️ Prisma 7（driver adapter）は `meta.target` を返さない。制約の名前は
 * `meta.driverAdapterError.cause.originalMessage`、列は `...cause.constraint.fields` に入る
 * （開発用の DB で実際に違反させて確かめた・2026-10-28）。ほかの一意制約の違反は「すでにある」にしない
 */
function isOnePrivateViolation(e: unknown): boolean {
  const err = e as {
    code?: string;
    meta?: {
      driverAdapterError?: {
        cause?: { originalMessage?: string; constraint?: { fields?: string[] } };
      };
    };
  };
  if (err.code !== 'P2002') {
    return false;
  }
  const cause = err.meta?.driverAdapterError?.cause;
  const fields = cause?.constraint?.fields ?? [];
  return (
    (cause?.originalMessage ?? '').includes('workspaces_one_private_per_owner') ||
    (fields.length === 1 && fields[0] === 'owner_id')
  );
}
