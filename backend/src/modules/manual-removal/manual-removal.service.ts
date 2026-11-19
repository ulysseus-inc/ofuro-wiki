import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * 以前のマニュアルのワークスペースの ID の範囲。先頭は固定で、末尾は内容の版ごとに変わっていた。
 * 列が UUID 型で startsWith を使えないため、範囲で指定する
 */
const MANUAL_WORKSPACE_IDS = {
  gte: 'ffffffff-ffff-4fff-bfff-000000000000',
  lte: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
};
/** マニュアルを持っていたシステムアカウント（ログイン不可） */
const MANUAL_SYSTEM_EMAIL = 'manual-system@ofuro-wiki.local';
/** マニュアルの本文の版の記録 */
const MANUAL_SEED_VERSION_KEY = 'manual_seed_version';

/**
 * #324: 📖 Manual ワークスペースをやめる（docs/docs-site.md 7 章）。
 * 使い方は本体が /docs/ で配る。
 *
 * デプロイして起動したときに、残っていれば消す。無ければ何もしない。
 * 参加の行・ページ・台帳は、ワークスペースのカスケードで消える。
 */
@Injectable()
export class ManualRemovalService {
  private readonly logger = new Logger(ManualRemovalService.name);

  constructor(private prisma: PrismaService) {}

  /** 消したワークスペースの数を返す */
  async remove(): Promise<number> {
    // 持ち主（システムアカウント）は外部キーで参照されるため、ワークスペースを先に消す
    const removed = await this.prisma.workspace.deleteMany({
      where: {
        OR: [
          { id: MANUAL_WORKSPACE_IDS },
          // ⚠️ isSystem も見る。システムアカウントを消した後は、このアドレスで誰でも登録でき、
          // メールだけで探すと、その人のワークスペースが起動のたびに消える
          { owner: { email: MANUAL_SYSTEM_EMAIL, isSystem: true } },
        ],
      },
    });
    await this.prisma.user.deleteMany({
      where: { email: MANUAL_SYSTEM_EMAIL, isSystem: true },
    });
    await this.prisma.serverSetting.deleteMany({
      where: { key: MANUAL_SEED_VERSION_KEY },
    });

    if (removed.count > 0) {
      this.logger.log(
        `マニュアルのワークスペースを消しました（${removed.count} 件）。使い方は /docs/ で配ります`,
      );
    }
    return removed.count;
  }
}
