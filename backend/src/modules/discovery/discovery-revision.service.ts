import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * #151: Discovery Index の版数を管理する。
 *
 * クライアントは手元のキャッシュに `revision` を持ち、サーバーの値と
 * 突き合わせて**古ければキャッシュを信用しない**。
 *
 * ## ⚠️ 通知と revision は役割が違う。両方要る
 *
 * | | 目的 | 効く場面 |
 * |---|---|---|
 * | 通知（invalidate） | **即時性** | 権限変更 → 対象利用者へ即座に伝える |
 * | **revision** | **整合性** | **通知を取り逃した**とき（アプリが落ちていた / WebSocket が切れていた / 複数タブ / オフライン） |
 *
 * revision だけでは即時性が無く、通知だけでは取り逃しに気づけない。
 *
 * ## ⚠️ 上げる契機
 *
 * **権限変更だけでは足りない。** Index の内容（作成・削除・改名・タグ）が
 * 変わったときも上げる。上げないと**権限は正しいのに一覧が古い**状態になる。
 *
 * ## ⚠️ 粒度
 *
 * ワークスペース単位で持つため、**1人の権限を変えると全員のキャッシュが
 * 失効する**。正しさを優先した割り切りで、利用者単位への細分化は
 * **最初からやらない**（docs/doc-permission.md「Discovery Index Local Cache」4）。
 */
@Injectable()
export class DiscoveryRevisionService {
  private readonly logger = new Logger(DiscoveryRevisionService.name);
  private readonly changedListeners: DiscoveryChangedListener[] = [];

  constructor(private prisma: PrismaService) {}

  /**
   * 版数を1つ進める。**Index に影響する変更のあと必ず呼ぶ。**
   *
   * ⚠️ **失敗しても呼び出し元を巻き込まない。** 版数が上がらなくても
   * データそのものは正しく、クライアントは次の変更で追いつく。
   * ここで例外を投げると、ドキュメントの保存自体が失敗してしまう。
   */
  async bump(
    workspaceId: string,
    reason: DiscoveryChangeReason,
  ): Promise<void> {
    try {
      await this.prisma.workspace.update({
        where: { id: workspaceId },
        data: { discoveryRevision: { increment: 1 } },
      });
    } catch (e: any) {
      // ワークスペースが既に消えている場合など
      this.logger.warn(
        `Failed to bump discovery revision (${reason}): ${e?.message ?? e}`,
      );
      // ⚠️ **上げられなかったなら知らせない。** 知らせると、受け取った側は
      // 版数を引いて「変わっていない」と判断し、取り直さずに終わる。
      // 何も起きなかったのと同じだが、無駄な問い合わせが全員に走る
      return;
    }

    this.notifyChanged(workspaceId, reason);
  }

  /**
   * 版数が変わったことを知らせる相手を登録する（#151 PR2・7.11）。
   *
   * ⚠️ **運ぶのは「変わった」という事実だけ**で、一覧の中身は運ばない。
   * 中身を載せると、**誰に何を配ってよいか**を配信側でも解くことになり、
   * 段階3 が避けてきたことをやり直す羽目になる。
   * 受け取った側が版数を引き、必要なら自分で取りに行く。
   */
  onChanged(listener: DiscoveryChangedListener): void {
    this.changedListeners.push(listener);
  }

  /**
   * ⚠️ **知らせるのは書き込みの「あと」だけ。**
   *
   * 先に知らせると、受け取った側が**古い一覧と新しい版数**を手元に固定し、
   * 以後サーバーと版数が一致するため**永久に取り直さない**
   * （`discovery-revision.spec.ts` が守っている性質と同じ）。
   *
   * ⚠️ **知らせる相手の失敗で呼び出し元を巻き込まない。** 配信できなくても
   * データは正しく、受け取り側は次の契機で追いつく。ここで投げると
   * **ドキュメントの保存自体が失敗する**。
   */
  private notifyChanged(
    workspaceId: string,
    reason: DiscoveryChangeReason,
  ): void {
    for (const listener of this.changedListeners) {
      try {
        listener(workspaceId, reason);
      } catch (e: any) {
        this.logger.warn(
          `Failed to notify discovery change (${reason}): ${e?.message ?? e}`,
        );
      }
    }
  }

  /** 現在の版数。クライアントが自分のキャッシュと突き合わせる。 */
  async current(workspaceId: string): Promise<string> {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { discoveryRevision: true },
    });
    // ⚠️ BigInt は JSON にできない。文字列で扱う
    return String(ws?.discoveryRevision ?? 0);
  }
}

/**
 * 版数を上げた理由。ログと、上げ忘れの検査に使う。
 *
 * ⚠️ **`<対象>.<操作>` 形式にしないこと。** その形は監査ログの action の
 * 命名規約であり（docs/logging.md 2.3）、監査ログの網羅性検査が
 * **接頭辞で拾う**ため、ここの値まで「記録されるべき action」と
 * 誤認されて検査が落ちる。ハイフン区切りにして区別する。
 *
 * ⚠️ **ここに列挙されている変更は、すべて `bump` を呼ぶこと。**
 * 呼び忘れると「権限は正しいのに一覧が古い」状態になる。
 */
export const DISCOVERY_CHANGE_REASONS = [
  // Index の内容が変わるもの
  'doc-create',
  'doc-update', // タイトル・タグ等の Discovery Metadata が変わった
  'doc-delete',
  // #151 段階3: ゴミ箱。サーバー側で持つようになったため追加した
  'doc-trash',
  'doc-restore',
  // 誰に見えるかが変わるもの
  'permission-doc',
  'permission-workspace',
] as const;

export type DiscoveryChangeReason = (typeof DISCOVERY_CHANGE_REASONS)[number];

/**
 * 版数が変わったことを受け取る相手（#151 PR2・7.11）。
 *
 * ⚠️ **一覧の中身は渡さない。** 「どのワークスペースで何かが変わったか」
 * だけを渡し、取りに行くかどうかは受け取った側が版数を見て決める。
 */
export type DiscoveryChangedListener = (
  workspaceId: string,
  reason: DiscoveryChangeReason,
) => void;
