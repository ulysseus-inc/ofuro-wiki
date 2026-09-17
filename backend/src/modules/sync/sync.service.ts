import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { isUniqueViolation } from '../../prisma-errors';
import { isUserDoc } from './user-doc';
import { mergeUpdates, diffUpdate, encodeStateVector } from './yjs.utils';
import { DocGcService } from '../discovery/doc-gc.service';

const SNAPSHOT_THRESHOLD = 50; // Rebuild snapshot after N updates

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private prisma: PrismaService,
    // #45: 完全削除で消すものは DocGcService が1か所で持つ
    private docGc: DocGcService,
  ) {}

  async loadDoc(
    workspaceId: string,
    docId: string,
    clientStateVector?: Uint8Array,
  ): Promise<{
    missing: Uint8Array;
    state: Uint8Array;
    timestamp: number;
  }> {
    // Get snapshot
    const snapshot = await this.prisma.docSnapshot.findUnique({
      where: {
        workspaceId_docId: { workspaceId, docId },
      },
    });

    // Get pending updates since snapshot
    const updates = await this.prisma.docUpdate.findMany({
      where: { workspaceId, docId },
      orderBy: { timestamp: 'asc' },
    });

    const allUpdates: Uint8Array[] = [];
    if (snapshot) {
      allUpdates.push(new Uint8Array(snapshot.blob));
    }
    for (const u of updates) {
      allUpdates.push(new Uint8Array(u.blob));
    }

    let fullUpdate: Uint8Array;
    if (allUpdates.length === 0) {
      // New doc — empty state
      const { encodeStateAsUpdate } = await import('yjs');
      const { Doc } = await import('yjs');
      const doc = new Doc();
      fullUpdate = encodeStateAsUpdate(doc);
    } else {
      fullUpdate = mergeUpdates(allUpdates);
    }

    const stateVector = encodeStateVector(fullUpdate);

    let missing: Uint8Array;
    if (clientStateVector && clientStateVector.length > 0) {
      missing = diffUpdate(fullUpdate, clientStateVector);
    } else {
      missing = fullUpdate;
    }

    return {
      missing,
      state: stateVector,
      timestamp: Date.now(),
    };
  }

  /**
   * #90: そのドキュメントの保存済みデータがまだ無いか（＝新規作成か）。
   *
   * ドキュメントはブラウザ側（Yjs）で作られ、サーバーには作成の通知が来ない。
   * **最初の更新が届いた時点で何も無ければ新規作成**とみなすための判定。
   * 呼び出し側が「接続ごと・ドキュメントごとに1回」に絞ること。
   */
  async isNewDoc(workspaceId: string, docId: string): Promise<boolean> {
    const [snapshot, update] = await Promise.all([
      this.prisma.docSnapshot.findFirst({
        where: { workspaceId, docId },
        select: { docId: true },
      }),
      this.prisma.docUpdate.findFirst({
        where: { workspaceId, docId },
        select: { id: true },
      }),
    ]);
    return !snapshot && !update;
  }

  async pushUpdate(
    workspaceId: string,
    docId: string,
    update: Uint8Array,
    editorId?: string,
  ): Promise<number> {
    const now = new Date();

    // Guard against stale client data: reject if workspace no longer exists
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!ws) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    // #151 stage 3: the body and the ledger's updated_at move together.
    //
    // WARNING: keep these in ONE transaction. Deferring the ledger write (a
    // debounce, a queue) reopens exactly the hole this fixes: the body saved,
    // the timestamp left behind. Editing the body is the only thing that makes
    // a document "fresh", and nothing else advances updated_at for it - the
    // client writes the ledger for title/trash/tags only, so Prisma's
    // @updatedAt never fires on a body-only edit. See docs 7.10.
    await this.prisma.$transaction(async (tx) => {
      await tx.docUpdate.create({
        data: {
          workspaceId,
          docId,
          blob: Buffer.from(update),
          timestamp: now,
          editorId,
        },
      });

      // ⚠️ ここから下は利用者のドキュメントだけ。ワークスペース自身や
      // `$` を含む内部データ（利用者ごとの設定など）は索引に載らないので、
      // 印を立てても巡回がむだに作り直しにいくだけ
      if (!isUserDoc(workspaceId, docId)) return;

      // #101: 索引の作り直しの印。⚠️ **本文と同じトランザクションで立てる。**
      // 分けると「本文は保存されたのに印が立たない」が起き、その編集は
      // 検索にもバックリンクにも永久に出ない（docs/search-index.md 5章）。
      // 作り直しは巡回（SearchIndexQueueService）が静まってから行う
      await tx.searchIndexQueue.upsert({
        where: { workspaceId_docId: { workspaceId, docId } },
        create: {
          workspaceId,
          docId,
          pendingGeneration: 1n,
          indexedGeneration: 0n,
          pendingAt: now,
        },
        update: {
          pendingGeneration: { increment: 1 },
          pendingAt: now,
        },
      });

      // WARNING: updateMany, not update. `update` throws P2025 when no row
      // exists and would take the user's body down with it. A missing ledger
      // row is not an error here - migration gaps and docs created before
      // stage 3 both produce one. Never lose a body over a bookkeeping row.
      await tx.docMeta.updateMany({
        where: {
          workspaceId,
          docId,
          // WARNING: never move the timestamp backwards. `now` is taken when
          // the push arrives, but the row lock is taken later, so two people
          // editing the same doc can commit out of order: the older
          // transaction wins the lock last and overwrites the newer value.
          // The freshness label would tick backwards and updatedById would
          // name the wrong person. Matching 0 rows here is the correct
          // outcome - a newer edit already recorded what we were going to say.
          updatedAt: { lte: now },
        },
        data: {
          // Set the same instant the update row carries, so "the body was
          // saved at T" and "the doc was last updated at T" cannot disagree.
          updatedAt: now,
          // editorId can be absent (the internal REST API does not carry
          // one). Overwriting a real editor with null would lose who touched
          // the doc last, so only write it when we actually know.
          ...(editorId ? { updatedById: editorId } : {}),
        },
      });
    });

    // Check if we should rebuild the snapshot
    const updateCount = await this.prisma.docUpdate.count({
      where: { workspaceId, docId },
    });

    if (updateCount >= SNAPSHOT_THRESHOLD) {
      await this.rebuildSnapshot(workspaceId, docId, editorId);
    }

    return now.getTime();
  }

  private async rebuildSnapshot(
    workspaceId: string,
    docId: string,
    editorId?: string,
  ) {
    this.logger.log(`Rebuilding snapshot for ${workspaceId}/${docId}`);

    const snapshot = await this.prisma.docSnapshot.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
    });

    const updates = await this.prisma.docUpdate.findMany({
      where: { workspaceId, docId },
      orderBy: { timestamp: 'asc' },
    });

    const allUpdates: Uint8Array[] = [];
    if (snapshot) {
      allUpdates.push(new Uint8Array(snapshot.blob));
    }
    for (const u of updates) {
      allUpdates.push(new Uint8Array(u.blob));
    }

    if (allUpdates.length === 0) return;

    const merged = mergeUpdates(allUpdates);
    const now = new Date();

    // マージした更新のIDのみを削除対象にする（マージ中に届いた新規更新を消さないため）
    const mergedIds = updates.map((u) => u.id);

    // ⚠️ **読んだときの版を条件に書くこと（CAS）。**
    // ここは読んだ内容を根拠にスナップショットを**丸ごと上書き**する。
    // 条件を付けないと、読んでから書くまでの間に起きた変更を消す。
    //
    // ```
    // 別処理  スナップショットを置き換える（例: #151 の目次の掃除）
    // 再構築  さきほど読んだ内容を併合して上書き → **置き換えが取り消される**
    // ```
    //
    // 再構築どうしが重なった場合も同じで、片方の併合結果が失われる。
    // 詳細は docs/discovery-stage3-comparison.md 7.8.7c
    const written = await this.prisma.$transaction(async (tx) => {
      if (snapshot) {
        const result = await tx.docSnapshot.updateMany({
          where: {
            workspaceId,
            docId,
            // 読んだときの版。変わっていたら書かない
            timestamp: snapshot.timestamp,
          },
          data: { blob: Buffer.from(merged), timestamp: now, editorId },
        });
        if (result.count === 0) return false;
      } else {
        // ⚠️ 版が無い（初回）。**取りこぼしを必ず捕まえること。**
        // 「作成できなければ他が先に作ったということ」と書きながら
        // 捕まえずにいたため、同時に初回再構築が走ると例外が飛んでいた。
        // ここは失敗ではなく「別の書き込みが先に入った」＝やり直しである
        try {
          await tx.docSnapshot.create({
            data: {
              workspaceId,
              docId,
              blob: Buffer.from(merged),
              timestamp: now,
              editorId,
            },
          });
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
          return false;
        }
      }

      // マージ済みの更新のみ削除（新規到着分は残す）
      await tx.docUpdate.deleteMany({ where: { id: { in: mergedIds } } });
      return true;
    });

    if (!written) {
      // ⚠️ 失敗ではない。**別の書き込みが先に入っただけ**なので、
      // ここでは何もしない（更新ログも消さない）。次の契機で再構築される
      this.logger.log(
        `Snapshot rebuild skipped for ${workspaceId}/${docId} (changed by another writer)`,
      );
      return;
    }

    this.logger.log(
      `Snapshot rebuilt for ${workspaceId}/${docId} (${updates.length} updates merged)`,
    );
  }

  async getDocSnapshot(workspaceId: string, docId: string) {
    return this.prisma.docSnapshot.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
    });
  }

  async getDocTimestamps(
    workspaceId: string,
    after?: number,
  ): Promise<Record<string, number>> {
    // Get latest timestamp for each doc from snapshots and updates
    const snapshots = await this.prisma.docSnapshot.findMany({
      where: {
        workspaceId,
        ...(after && { timestamp: { gt: new Date(after) } }),
      },
      select: { docId: true, timestamp: true },
    });

    const updates = await this.prisma.docUpdate.groupBy({
      by: ['docId'],
      where: {
        workspaceId,
        ...(after && { timestamp: { gt: new Date(after) } }),
      },
      _max: { timestamp: true },
    });

    const result: Record<string, number> = {};

    for (const s of snapshots) {
      result[s.docId] = s.timestamp.getTime();
    }

    for (const u of updates) {
      const ts = u._max.timestamp?.getTime() ?? 0;
      if (!result[u.docId] || ts > result[u.docId]) {
        result[u.docId] = ts;
      }
    }

    return result;
  }

  /**
   * ページを完全に消す（`space:delete-doc` の受け口）。
   *
   * ⚠️ 消す対象は `DocGcService` が持つ。GraphQL の `deleteDocMeta` と
   * **同じ場所**を通す（docs/permanent-delete.md 5章）
   */
  async deleteDoc(workspaceId: string, docId: string) {
    await this.docGc.purge(workspaceId, docId);
  }
}
