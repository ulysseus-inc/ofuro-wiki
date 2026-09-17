import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRole } from '../../common/decorators/workspace-role.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceMemberGuard } from '../../common/guards/workspace-member.guard';
import { DiscoveryService } from './discovery.service';
import { DocMetaWriteService } from './doc-meta-write.service';
import type { DocMetaWriteResult } from './doc-meta-write.service';
import {
  DiscoverySnapshotType,
  DocMetaWriteResultType,
} from './discovery.model';

/**
 * #151: Discovery Index を返す。
 *
 * ⚠️ Guard はワークスペースの入口しか見ない。**doc 単位の絞り込みは
 * DiscoveryService が PermissionService に委ねて行う**（判定を散らさない）。
 */
@Resolver()
@UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
export class DiscoveryResolver {
  constructor(
    private discovery: DiscoveryService,
    private write: DocMetaWriteService,
  ) {}

  /** 認可済み Snapshot。起動時・復帰時にこれを取る。 */
  @Query(() => DiscoverySnapshotType)
  @WorkspaceRole('reader')
  async discoverySnapshot(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @CurrentUser() user: { id: string },
  ): Promise<DiscoverySnapshotType> {
    const snap = await this.discovery.snapshot(workspaceId, user.id);
    return {
      ...snap,
      documents: snap.documents.map((d) => ({
        ...d,
        title: d.title ?? undefined,
        createdBy: d.createdBy ?? undefined,
        updatedBy: d.updatedBy ?? undefined,
      })),
    };
  }

  /**
   * 版数だけを返す。**キャッシュが最新かの確認に使う。**
   *
   * 一覧全体を取らずに済むよう分けてある（起動時・復帰時に毎回呼ばれるため）。
   */
  @Query(() => String)
  @WorkspaceRole('reader')
  async discoveryRevision(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
  ): Promise<string> {
    return this.discovery.currentRevision(workspaceId);
  }

  // ───────────────────────────── 書き込み（#151 段階3）
  //
  // ⚠️ **値型と操作型を分けている。**
  // `title` / `trash` は版数で競合を弾く。`tags` は add / remove の操作型で、
  // 版数を見ない（順序に依存しないため）。詳細は 7.5.10。
  //
  // ⚠️ Guard はワークスペースの入口しか見ない。**doc 単位の認可は
  // DocMetaWriteService が PermissionService に委ねて行う**（判定を散らさない）。

  /**
   * 題を変更する。
   *
   * @param observedTitle ⚠️ **もう見ていない**（7.7.5 で移行判定を撤去）。
   *   受け取って捨てるだけ。
   *
   *   ⚠️ **まだ消さないこと。** クライアントは送るのをやめたが（2026-09-10）、
   *   **古い版を開いたままのブラウザは送り続けている**。ここを消すと GraphQL が
   *   未知の引数として弾き、**その人の題の変更が全部失敗する**。
   *   全員が読み込み直したあと、別の版で消す（7.7.5 の段2）
   */
  @Mutation(() => DocMetaWriteResultType)
  @WorkspaceRole('member')
  async setDocTitle(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('docId', { type: () => String }) docId: string,
    @Args('title', { type: () => String }) title: string,
    @Args('baseRevision', { type: () => String }) baseRevision: string,
    @CurrentUser() user: { id: string },
    @Args('observedTitle', { type: () => String, nullable: true })
    observedTitle?: string,
  ): Promise<DocMetaWriteResultType> {
    return this.toGraphql(
      await this.write.setTitle({
        workspaceId,
        docId,
        userId: user.id,
        title,
        baseRevision: BigInt(baseRevision),
      }),
    );
  }

  /**
   * ページを台帳へ登録する（#151 段階3）。
   *
   * ⚠️ これが呼ばれないと、**新しく作ったページが誰の一覧にも出ない**。
   * 段階2 までは `doc-meta-sync` が Yjs 目次から作っていた。
   */
  @Mutation(() => DocMetaWriteResultType)
  @WorkspaceRole('member')
  async createDocMeta(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('docId', { type: () => String }) docId: string,
    @CurrentUser() user: { id: string },
    @Args('title', { type: () => String, nullable: true }) title?: string,
    @Args('mode', { type: () => String, nullable: true }) mode?: string,
  ): Promise<DocMetaWriteResultType> {
    return this.toGraphql(
      await this.write.createDoc({
        workspaceId,
        docId,
        userId: user.id,
        title: title ?? '',
        mode: mode ?? 'page',
      }),
    );
  }

  /** ページを台帳から消す（#151 段階3）。 */
  @Mutation(() => DocMetaWriteResultType)
  @WorkspaceRole('member')
  async deleteDocMeta(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('docId', { type: () => String }) docId: string,
    @CurrentUser() user: { id: string },
  ): Promise<DocMetaWriteResultType> {
    return this.toGraphql(
      await this.write.deleteDoc({ workspaceId, docId, userId: user.id }),
    );
  }

  /**
   * ゴミ箱へ入れる / 戻す。
   *
   * @param observedTrash ⚠️ `observedTitle` と同じく**もう見ていない**（7.7.5）。
   *   同じ理由で、まだ消さない（段2 待ち）。
   *   受け取って捨てるだけで、**引数ごと消さないこと**
   */
  @Mutation(() => DocMetaWriteResultType)
  @WorkspaceRole('member')
  async setDocTrash(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('docId', { type: () => String }) docId: string,
    @Args('trash', { type: () => Boolean }) trash: boolean,
    @Args('baseRevision', { type: () => String }) baseRevision: string,
    @CurrentUser() user: { id: string },
    @Args('observedTrash', { type: () => Boolean, nullable: true })
    observedTrash?: boolean,
  ): Promise<DocMetaWriteResultType> {
    return this.toGraphql(
      await this.write.setTrash({
        workspaceId,
        docId,
        userId: user.id,
        trash,
        baseRevision: BigInt(baseRevision),
      }),
    );
  }

  /**
   * タグを**要素単位**で足す / 外す。
   *
   * ⚠️ **配列全体を送らせないこと。** 送ると2人が別のタグを付けたときに
   * 一方が消える（#164 と同じ形）。
   */
  @Mutation(() => DocMetaWriteResultType)
  @WorkspaceRole('member')
  async changeDocTags(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('docId', { type: () => String }) docId: string,
    @CurrentUser() user: { id: string },
    @Args('add', { type: () => [String], nullable: true }) add?: string[],
    @Args('remove', { type: () => [String], nullable: true }) remove?: string[],
  ): Promise<DocMetaWriteResultType> {
    return this.toGraphql(
      await this.write.changeTags({
        workspaceId,
        docId,
        userId: user.id,
        add: add ?? [],
        remove: remove ?? [],
      }),
    );
  }

  /** ⚠️ BigInt は JSON にできない。文字列に直す（`discoveryRevision` と同じ） */
  private toGraphql(result: DocMetaWriteResult): DocMetaWriteResultType {
    return {
      status: result.status,
      revision:
        result.revision === undefined ? undefined : String(result.revision),
      currentTitle: result.currentTitle ?? undefined,
      currentTrash: result.currentTrash,
      // #151 段階3: 作成のときだけ入る（7.12）
      titleRevision:
        result.revisions === undefined
          ? undefined
          : String(result.revisions.title),
      trashRevision:
        result.revisions === undefined
          ? undefined
          : String(result.revisions.trash),
      tagsRevision:
        result.revisions === undefined
          ? undefined
          : String(result.revisions.tags),
    };
  }
}
