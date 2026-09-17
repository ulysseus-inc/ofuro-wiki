import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PermissionService } from '../permission/permission.service';
import { DiscoveryRevisionService } from './discovery-revision.service';

/**
 * #151: Discovery Index。**「その利用者が存在を知ってよいドキュメント」**を返す。
 *
 * ⚠️ **Read Authorization（本文を読んでよいか）とは別の関心事。**
 * ここが返すのは Discovery Metadata（存在・タイトル・タグ・日時）だけで、
 * **本文は含まない**（docs/doc-permission.md「認可は2種類ある」）。
 *
 * ⚠️ **認可の判定をここに書かない。** `PermissionService` に委ねる
 * （同 6.0。判定が各所に散ると、片方だけ直った状態が生まれる）。
 */
@Injectable()
export class DiscoveryService {
  constructor(
    private prisma: PrismaService,
    private permission: PermissionService,
    private revision: DiscoveryRevisionService,
  ) {}

  /**
   * 認可済み Snapshot を返す。
   *
   * ⚠️ 戻り値に `revision` と `userId` を含めること。クライアントは
   * これを持って初めて「誰にとって・いつ時点で認可された結果か」を
   * 判定できる（同「Discovery Index Local Cache」3）。
   */
  async snapshot(
    workspaceId: string,
    userId: string,
  ): Promise<DiscoverySnapshot> {
    // ⚠️ 版数は**先に**取る。あとで取ると、この処理中に起きた変更を
    // 「取り込み済み」と誤認し、その変更が永久に届かなくなる
    const revision = await this.revision.current(workspaceId);

    const metas = await this.prisma.docMeta.findMany({
      where: { workspaceId },
      select: {
        docId: true,
        title: true,
        tagIds: true,
        mode: true,
        // ⚠️ 返さないと一覧に削除済みが出る（doc_meta.trash）
        trash: true,
        createdAt: true,
        updatedAt: true,
        createdById: true,
        updatedById: true,
        // #151 段階3: クライアントが書き込み時の baseRevision を決めるために要る
        titleRevision: true,
        trashRevision: true,
        tagsRevision: true,
        // ⚠️ 本文は取らない。Discovery Index は存在を知るためのもの
      },
      orderBy: { updatedAt: 'desc' },
    });

    // 読める doc に絞る（判定は PermissionService が持つ）
    const readable = new Set(
      await this.permission.filterReadable(
        workspaceId,
        metas.map((m) => m.docId),
        userId,
      ),
    );

    return {
      workspaceId,
      userId,
      revision,
      fetchedAt: new Date().toISOString(),
      documents: metas
        .filter((m) => readable.has(m.docId))
        .map((m) => ({
          id: m.docId,
          title: m.title,
          tagIds: m.tagIds,
          mode: m.mode,
          trash: m.trash,
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
          createdBy: m.createdById,
          updatedBy: m.updatedById,
          // ⚠️ BigInt は JSON にできない。文字列にする
          titleRevision: String(m.titleRevision),
          trashRevision: String(m.trashRevision),
          tagsRevision: String(m.tagsRevision),
        })),
    };
  }

  /**
   * 版数だけを返す。**キャッシュが最新かの確認に使う。**
   *
   * 一覧全体を取らずに済むよう分けてある（起動時・復帰時に毎回呼ばれる）。
   */
  async currentRevision(workspaceId: string): Promise<string> {
    return this.revision.current(workspaceId);
  }
}

/** 認可済み Snapshot。**本文を含まない。** */
export interface DiscoverySnapshot {
  workspaceId: string;
  /** ⚠️ 誰にとって認可された結果か。キャッシュの正当性判定に要る */
  userId: string;
  /** ⚠️ サーバーのどの時点か。古ければクライアントは信用しない */
  revision: string;
  fetchedAt: string;
  documents: DiscoveryDocument[];
}

/**
 * Discovery Metadata。
 *
 * ⚠️ **ここに本文・Yjs ドキュメント・エディタ状態を足さないこと。**
 * 「存在を知るための情報」だけを持つ、という約束が崩れる。
 */
export interface DiscoveryDocument {
  /**
   * #151 段階3: フィールド単位の版数（文字列）。
   *
   * ⚠️ **これが無いと、クライアントは書き込み時の `baseRevision` を
   * 決められず、競合制御が働かない**（7.5.10）。
   */
  titleRevision: string;
  trashRevision: string;
  tagsRevision: string;

  id: string;
  title: string | null;
  tagIds: string[];
  mode: string;
  /** ⚠️ ゴミ箱に入っているか。落とすと一覧に削除済みが出る */
  trash: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}
