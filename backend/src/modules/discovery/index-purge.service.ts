import { Injectable, Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma.service';
import { isUniqueViolation } from '../../prisma-errors';
import { judgeIndexEntry } from './index-entry-safety';
import type { IndexEntry } from './index-entry-safety';

/**
 * #151 段階3 PR5-b: **共有目次（`meta.pages`）から題を消す。**
 *
 * PR5-a で新しく作るページは目次に載らなくなったが、
 * **既に載っている題は、いまも全メンバーへ配信され続けている**。
 * 一覧を台帳で絞って「表示していない」だけで、データは手元にある。
 *
 * ## ⚠️ 削除するだけでは題は消えない（実験で確認・2026-08-27）
 *
 * Yjs は削除しても墓標を残す。更新ログをそのまま配信する限り、
 * **元の挿入（題を含む）はクライアントへ届く**。
 *
 * | 操作 | 題が残るか |
 * |---|:---:|
 * | 削除して**再エンコード**（GC 有効） | **含まない** |
 * | `Y.mergeUpdates` で併合 | **含む**（二進の併合で削除内容を捨てない） |
 * | GC を切って再エンコード | **含む** |
 *
 * したがって「削除」ではなく **「削除したうえで状態を作り直し、保存を置き換える」**。
 *
 * ## ⚠️ 古い複製から復活しない（実験で確認）
 *
 * GC は削除内容を捨てるが、**「そのIDは削除済み」という情報は残す**。
 * だから掃除前の複製を持つクライアントと同期しても、削除済みとして扱われる。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.8
 */
@Injectable()
export class IndexPurgeService {
  private readonly logger = new Logger(IndexPurgeService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 1ワークスペースの目次を掃除する。
   *
   * @param dryRun 何も書き換えず、消せる件数だけ数える
   */
  async purgeWorkspace(
    workspaceId: string,
    dryRun = true,
  ): Promise<PurgeResult> {
    const result: PurgeResult = {
      workspaceId,
      indexed: 0,
      purged: 0,
      spacesIndexed: 0,
      spacesPurged: 0,
      kept: [],
      historiesDeleted: 0,
      applied: false,
      retriedForConflict: false,
    };

    // ルート文書＝ワークスペースIDと同じ docId
    const docId = workspaceId;

    const snapshot = await this.prisma.docSnapshot.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
    });
    const updates = await this.prisma.docUpdate.findMany({
      where: { workspaceId, docId },
      orderBy: { id: 'asc' },
    });

    if (!snapshot && updates.length === 0) return result;

    // ⚠️ **読んだ範囲を控える。** 置き換えの直前に「その後の更新が無い」
    // ことを確かめるために要る（7.8.7a）。
    // 境界を持たずに消すと、**掃除中に届いた利用者の変更を失う**
    const boundary = updates.length > 0 ? updates[updates.length - 1].id : null;

    // ⚠️ **GC を有効にして読むこと**（既定で有効）。切ると削除内容が残り、
    // 作り直しても題が消えない
    const doc = new Y.Doc();
    if (snapshot) Y.applyUpdate(doc, new Uint8Array(snapshot.blob));
    for (const u of updates) Y.applyUpdate(doc, new Uint8Array(u.blob));

    const pages = doc.getMap('meta').get('pages');

    // #151 PR5-c: `spaces` の docId も消す（7.9）。
    //
    // ⚠️ **判定は要らない。** `spaces` の値は「その docId の subdoc」でしかなく、
    // 台帳と食い違う値を持たない。`meta.pages` のような「版数 0 なら目次が正」
    // に相当する論点が無いので、**全件が無条件に消せる**。
    //
    // ⚠️ **フロントエンドが書くのをやめたあとに掃除すること。**
    // 書き込みが残っていると、ページを開いた瞬間に id が書き戻る
    const spaces = doc.getMap('spaces');
    result.spacesIndexed = spaces.size;
    result.spacesPurged = spaces.size;

    // ⚠️ **目次が空でも先に返さないこと。** PR5-b で `meta.pages` を掃除した
    // あとの本番がまさにこの状態で、目次は 0 件でも `spaces` に 124 件の
    // docId が残っていた。ここで返すと **PR5-c が何もしない**
    const removable = await this.selectRemovablePages(
      workspaceId,
      pages,
      result,
    );

    result.purged = removable.length;
    if (dryRun) return result;
    if (removable.length === 0 && spaces.size === 0) return result;

    if (pages instanceof Y.Array) {
      // ⚠️ 後ろから消すこと。前から消すと添字がずれる
      for (const i of [...removable].reverse()) pages.delete(i, 1);
    }
    for (const key of [...spaces.keys()]) spaces.delete(key);

    const rebuilt = Y.encodeStateAsUpdate(doc);

    result.applied = await this.commit({
      workspaceId,
      docId,
      rebuilt,
      boundary,
      expectedTimestamp: snapshot?.timestamp ?? null,
      result,
    });

    return result;
  }

  /**
   * 目次のうち、**消してよい項目の添字**を選ぶ。消さないものは理由を控える。
   */
  private async selectRemovablePages(
    workspaceId: string,
    pages: unknown,
    result: PurgeResult,
  ): Promise<number[]> {
    if (!(pages instanceof Y.Array) || pages.length === 0) return [];

    result.indexed = pages.length;

    // ⚠️ **1件ずつ確かめる**（7.8.5）。事前の点検結果は「その瞬間」の
    // 判定でしかなく、点検と掃除のあいだに台帳に無いページが増え得る。
    //
    // ⚠️ **判定は `judgeIndexEntry` に委ねること。** 点検と別々に書いた
    // ところ食い違い、**597 件中 595 件を消せない**状態になった（2026-08-27）
    const metas = await this.prisma.docMeta.findMany({
      where: { workspaceId },
      select: {
        docId: true,
        title: true,
        tagIds: true,
        trash: true,
        titleRevision: true,
        trashRevision: true,
        tagsRevision: true,
      },
    });
    const byId = new Map(metas.map((m) => [m.docId, m]));

    const removable: number[] = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages.get(i) as Y.Map<unknown> | undefined;
      const id = page?.get?.('id');
      if (typeof id !== 'string') {
        result.kept.push({ index: i, reason: 'id が読めない' });
        continue;
      }

      const entry: IndexEntry = {
        id,
        title: (page?.get('title') as string | undefined) ?? null,
        tags: readTags(page?.get('tags')),
        trash: page?.get('trash') === true,
      };

      const judgement = judgeIndexEntry(entry, byId.get(id));
      if (!judgement.purgeable) {
        result.kept.push({ index: i, docId: id, reason: judgement.reason });
        continue;
      }
      removable.push(i);
    }

    return removable;
  }

  /**
   * 置き換えを1つのトランザクションで行う。
   *
   * ⚠️ **版と境界の両方を確かめること。** どちらか一方では足りない。
   * 版だけだと掃除中に届いた更新を消し、境界だけだと再構築による
   * 上書きを見逃す（7.8.7a / 7.8.7c）。
   */
  private async commit(params: {
    workspaceId: string;
    docId: string;
    rebuilt: Uint8Array;
    boundary: bigint | null;
    expectedTimestamp: Date | null;
    result: PurgeResult;
  }): Promise<boolean> {
    const { workspaceId, docId, rebuilt, boundary, expectedTimestamp, result } =
      params;

    return this.prisma.$transaction(async (tx) => {
      // ⚠️ 読んだあとに届いた更新が在れば、**何もせずにやり直す**。
      // 消せば利用者の変更が失われ、残せば掃除後の状態に適用されて
      // 新しい ID の目次項目として題が再出現する
      const newer = await tx.docUpdate.count({
        where: {
          workspaceId,
          docId,
          ...(boundary === null ? {} : { id: { gt: boundary } }),
        },
      });
      if (newer > 0) {
        result.retriedForConflict = true;
        return false;
      }

      const now = new Date();
      if (expectedTimestamp) {
        const written = await tx.docSnapshot.updateMany({
          // 読んだときの版。変わっていたら書かない
          where: { workspaceId, docId, timestamp: expectedTimestamp },
          data: { blob: Buffer.from(rebuilt), timestamp: now },
        });
        if (written.count === 0) {
          result.retriedForConflict = true;
          return false;
        }
      } else {
        // ⚠️ **他が先に作った場合を捕まえること。** 更新ログしか無い状態で
        // 掃除している最中に、同期がスナップショットを作りにくることがある。
        // そこで例外を投げると、掃除全体が落ちて「競合で中止」を報告できない
        try {
          await tx.docSnapshot.create({
            data: {
              workspaceId,
              docId,
              blob: Buffer.from(rebuilt),
              timestamp: now,
            },
          });
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
          result.retriedForConflict = true;
          return false;
        }
      }

      if (boundary !== null) {
        await tx.docUpdate.deleteMany({
          where: { workspaceId, docId, id: { lte: boundary } },
        });
      }

      // ⚠️ **履歴にも題が残る**（7.8.6）。ルート文書には doc 単位の
      // 権限行が無いため、メンバーなら履歴を読める。消さなければ
      // **掃除しても履歴から題が取れる**
      const histories = await tx.docHistory.deleteMany({
        where: { workspaceId, docId },
      });
      result.historiesDeleted = histories.count;

      return true;
    });
  }

  /**
   * 掃除が本当に終わったかを確かめる。
   *
   * ⚠️ **「消した」ではなく「どこにも無い」を確かめる**（7.8.7d）。
   */
  async verify(workspaceId: string): Promise<PurgeVerification> {
    const docId = workspaceId;

    const snapshot = await this.prisma.docSnapshot.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
    });

    let indexed = 0;
    let spaces = 0;
    if (snapshot) {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, new Uint8Array(snapshot.blob));
      const pages = doc.getMap('meta').get('pages');
      indexed = pages instanceof Y.Array ? pages.length : 0;
      // #151 PR5-c: 題が消えても docId が残っていれば存在は漏れる（7.9）
      spaces = doc.getMap('spaces').size;
    }

    const [updates, histories] = await Promise.all([
      this.prisma.docUpdate.count({ where: { workspaceId, docId } }),
      this.prisma.docHistory.count({ where: { workspaceId, docId } }),
    ]);

    return { workspaceId, indexed, spaces, updates, histories };
  }
}

export interface PurgeResult {
  workspaceId: string;
  /** 掃除前に目次へ載っていた件数 */
  indexed: number;
  /** 消した（または dryRun なら消せる）件数 */
  purged: number;
  /** #151 PR5-c: `spaces` に載っていた docId の件数（7.9） */
  spacesIndexed: number;
  /**
   * `spaces` から消した（または dryRun なら消せる）件数。
   * **判定が無いので常に全件**（7.9.6）。
   *
   * ⚠️ `purged` と同じく、**競合で中止したときも件数が入る**。
   * 報告に使う側は `applied` を見てから足すこと
   */
  spacesPurged: number;
  /** ⚠️ 消さなかったもの。**残す判断には必ず理由が要る** */
  kept: Array<{ index: number; docId?: string; reason: string }>;
  historiesDeleted: number;
  /** 実際に書き換えたか */
  applied: boolean;
  /** 競合で中止したか（やり直しが要る） */
  retriedForConflict: boolean;
}

export interface PurgeVerification {
  workspaceId: string;
  /** 掃除後のスナップショットに残る目次の件数 */
  indexed: number;
  /** 掃除後のスナップショットに残る `spaces` の docId 件数（7.9） */
  spaces: number;
  /** 残っている更新ログ */
  updates: number;
  /** 残っている履歴 */
  histories: number;
}

/** ⚠️ 目次のタグは Y.Array のことがある。取り違えると常に「食い違い」になる */
function readTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((t): t is string => typeof t === 'string');
  const asArray = value as { toArray?: () => unknown[] } | undefined;
  if (typeof asArray?.toArray === 'function') {
    return asArray.toArray().filter((t): t is string => typeof t === 'string');
  }
  return [];
}
