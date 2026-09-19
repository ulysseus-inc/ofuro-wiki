import { Injectable, Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma.service';

interface BlockData {
  blockId: string;
  blockType: string;
  content: string;
  /**
   * #101: 画面がバックリンクの一覧に出す文。
   *
   * ⚠️ **空にしないこと。** 画面は空の参照を表示しない
   * （`bi-directional-link-panel.tsx`）。リンクは1文字の埋め込みなので、
   * ブロックの文字だけを入れるとほぼ空になる。
   */
  markdownPreview?: string;
  /** #101: このブロックが参照しているページ。バックリンクに使う */
  refDocId?: string;
  parentBlockId?: string;
  parentFlavour?: string;
  /**
   * #248: 行の補足。いまはキャンバスの要素の ID を入れる。
   *
   * ⚠️ surface の要素は**ブロックではない**ので `blockId` には入れられない。
   * どの図形が当たったかを画面へ渡せるよう、ここに残しておく。
   */
  additional?: string;
}

/**
 * #101: ページを埋め込むブロック。`prop:pageId` が参照先。
 *
 * ⚠️ `affine:embed-youtube` などの外部の埋め込みと混ぜないこと。
 * あれは `prop:url` を持つだけで、ページ参照ではない。
 */
const EMBED_DOC_FLAVOURS = new Set([
  'affine:embed-linked-doc',
  'affine:embed-synced-doc',
]);

/** #91: 巨大な表で1レコードが肥大化しないための上限 */
const MAX_DATABASE_TEXT_LENGTH = 10000;

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(private prisma: PrismaService) {}

  scheduleIndex(workspaceId: string, docId: string) {
    const key = `${workspaceId}:${docId}`;
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        this.indexDocument(workspaceId, docId).catch((err) => {
          this.logger.error(
            `Failed to index ${workspaceId}/${docId}: ${err.message}`,
          );
        });
      }, 3000),
    );
  }

  async indexDocument(workspaceId: string, docId: string) {
    // Load the latest doc state
    const snapshot = await this.prisma.docSnapshot.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
    });

    const updates = await this.prisma.docUpdate.findMany({
      where: { workspaceId, docId },
      orderBy: { timestamp: 'asc' },
    });

    const doc = new Y.Doc();
    if (snapshot) {
      Y.applyUpdate(doc, new Uint8Array(snapshot.blob));
    }
    for (const u of updates) {
      Y.applyUpdate(doc, new Uint8Array(u.blob));
    }

    // Extract blocks from Yjs doc
    const blocks = this.extractBlocks(doc);
    const title = this.extractTitle(doc);

    // Delete old index entries for this doc
    await this.prisma.searchIndex.deleteMany({
      where: { workspaceId, docId },
    });

    // Insert new entries
    if (blocks.length > 0) {
      await this.prisma.searchIndex.createMany({
        data: blocks.map((block) => ({
          workspaceId,
          docId,
          blockId: block.blockId,
          title,
          content: block.content,
          blockType: block.blockType,
          // #101: バックリンク用
          refDocId: block.refDocId,
          parentBlockId: block.parentBlockId,
          parentFlavour: block.parentFlavour,
          markdownPreview: block.markdownPreview ?? block.content ?? undefined,
          // #248: キャンバスの要素の ID
          additional: block.additional,
        })),
      });
    } else if (title) {
      // At minimum, index the title
      await this.prisma.searchIndex.create({
        data: {
          workspaceId,
          docId,
          title,
          content: title,
          blockType: 'title',
        },
      });
    }

    this.logger.log(
      `Indexed ${workspaceId}/${docId}: ${blocks.length} blocks`,
    );
  }

  async indexAllDocuments(workspaceId: string) {
    // ⚠️ **スナップショットだけを見ないこと。**
    // スナップショットは更新50回ごとにしか作られない（SNAPSHOT_THRESHOLD）。
    // 見落とすと、それ未満のページが丸ごと索引から漏れる
    // （開発DB実測: スナップショットあり37 / 更新ログのみ644・#101）
    const [snapshots, updates] = await Promise.all([
      this.prisma.docSnapshot.findMany({
        where: { workspaceId },
        select: { docId: true },
      }),
      this.prisma.docUpdate.findMany({
        where: { workspaceId },
        select: { docId: true },
        distinct: ['docId'],
      }),
    ]);

    const docIds = [
      ...new Set([
        ...snapshots.map((s) => s.docId),
        ...updates.map((u) => u.docId),
      ]),
    ];

    this.logger.log(
      `Reindexing workspace ${workspaceId}: ${docIds.length} documents`,
    );

    for (const docId of docIds) {
      try {
        await this.indexDocument(workspaceId, docId);
      } catch (err) {
        this.logger.error(
          `Failed to index ${workspaceId}/${docId}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(`Reindex complete for workspace ${workspaceId}`);
  }

  private extractTitle(doc: Y.Doc): string | undefined {
    // AFFiNE stores page meta in a shared map
    try {
      const meta = doc.getMap('meta');
      const title = meta?.get('title');
      if (typeof title === 'string') return title;
    } catch {
      // ignore
    }

    // Fallback: try to get title from blocks
    try {
      const blocks = doc.getMap('blocks');
      if (blocks) {
        for (const [, value] of blocks.entries()) {
          if (value instanceof Y.Map) {
            const flavour = value.get('sys:flavour');
            if (flavour === 'affine:page') {
              const title = value.get('prop:title');
              if (title instanceof Y.Text) {
                return title.toString();
              }
            }
          }
        }
      }
    } catch {
      // ignore
    }

    return undefined;
  }

  /**
   * #91: データベースブロック（affine:database）から検索対象テキストを取り出す。
   *
   * データ構造（`frontend/blocksuite/affine/model/.../database-model.ts`）:
   *   prop:columns … [{ id, type, name, data }]
   *   prop:cells   … { 行ID: { 列ID: { columnId, value } } }
   *
   * 行の見出し（タイトル列）は子ブロック（affine:paragraph / affine:list）として
   * 別途インデックスされるため、ここでは扱わない。
   */
  private extractDatabaseText(block: Y.Map<any>): string | undefined {
    const parts: string[] = [];
    let truncated = false;

    try {
      // 列の定義（列名・型・選択肢）を先に読む
      const columns = this.toPlain(block.get('prop:columns'));
      const columnById = new Map<
        string,
        { type?: string; options: Map<string, string> }
      >();

      if (Array.isArray(columns)) {
        for (const column of columns) {
          if (!column || typeof column !== 'object') continue;

          // 列名そのものも検索対象にする（「担当者」で探せるように）
          if (typeof column.name === 'string' && column.name.trim()) {
            parts.push(column.name.trim());
          }

          const options = new Map<string, string>();
          const rawOptions = (column.data as Record<string, unknown>)?.options;
          if (Array.isArray(rawOptions)) {
            for (const option of rawOptions) {
              if (option && typeof option === 'object' && option.id != null) {
                options.set(String(option.id), String(option.value ?? ''));
              }
            }
          }

          if (column.id != null) {
            columnById.set(String(column.id), {
              type: typeof column.type === 'string' ? column.type : undefined,
              options,
            });
          }
        }
      }

      // セルの値
      let length = parts.reduce((sum, part) => sum + part.length + 1, 0);
      const cells = this.toPlain(block.get('prop:cells'));

      if (cells && typeof cells === 'object') {
        rows: for (const row of Object.values(cells as Record<string, unknown>)) {
          if (!row || typeof row !== 'object') continue;

          for (const cell of Object.values(row as Record<string, unknown>)) {
            if (!cell || typeof cell !== 'object') continue;

            const { columnId, value } = cell as {
              columnId?: unknown;
              value?: unknown;
            };
            const column =
              columnId != null ? columnById.get(String(columnId)) : undefined;

            const rendered = this.renderCellValue(value, column);
            if (!rendered) continue;

            // 上限に達したら打ち切る。文字列を積んでから切り捨てるのではなく、
            // 積む前に止めることで巨大な表でも余分なメモリを使わない。
            if (length + rendered.length + 1 > MAX_DATABASE_TEXT_LENGTH) {
              truncated = true;
              break rows;
            }

            parts.push(rendered);
            length += rendered.length + 1;
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Database block extraction failed: ${err}`);
    }

    if (parts.length === 0) return undefined;

    if (truncated) {
      // 静かに欠落すると原因調査が困難になるため記録する
      this.logger.debug(
        `Database block text truncated at ${MAX_DATABASE_TEXT_LENGTH} chars; ` +
          `後半の行は検索対象に含まれません`
      );
    }

    return parts.join(' ').trim();
  }

  /** セルの値を検索用テキストに変換する。検索の役に立たない値は undefined を返す。 */
  private renderCellValue(
    value: unknown,
    column?: { type?: string; options: Map<string, string> }
  ): string | undefined {
    if (value == null) return undefined;

    // チェックボックスは true/false であり、検索語にならない
    if (typeof value === 'boolean') return undefined;

    if (typeof value === 'number') {
      if (column?.type === 'date') return this.renderDateValue(value);

      // 進捗（0〜100）は「0」「50」といった値が大量に入り、検索ノイズになるだけなので除外する
      if (column?.type === 'progress') return undefined;

      return String(value);
    }

    if (typeof value === 'string') {
      // select は選択肢 ID が入るため、表示名に解決する
      return column?.options.get(value) ?? value;
    }

    if (Array.isArray(value)) {
      // multi-select
      const items = value
        .map(item =>
          typeof item === 'string'
            ? (column?.options.get(item) ?? item)
            : this.renderCellValue(item, column)
        )
        .filter(Boolean);
      return items.length ? items.join(' ') : undefined;
    }

    return undefined;
  }

  /**
   * 日付セル（タイムスタンプ）を検索用の `YYYY-MM-DD` に変換する。
   *
   * フロントエンドは date-fns の `format(value, 'yyyy-MM-dd')`（＝ブラウザの
   * ローカルタイムゾーン）で表示・保存する。一方サーバーを UTC で動かすと、
   * JST で 2026-07-28 を選んだ値が UTC では 2026-07-27 になり、
   * **画面に見えている日付で検索してもヒットしない**。
   *
   * サーバーとブラウザのタイムゾーンが一致する保証はないため、
   * 両方が異なる場合は両方を検索対象に含める。
   */
  private renderDateValue(value: number): string | undefined {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;

    const local = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
    const utc = date.toISOString().slice(0, 10);

    return local === utc ? local : `${local} ${utc}`;
  }

  /** Yjs の型（Y.Map / Y.Array / Y.Text）を素の JS 値に変換する。 */
  private toPlain(value: unknown): unknown {
    if (value instanceof Y.Text) return value.toString();
    if (value instanceof Y.Map || value instanceof Y.Array) {
      return value.toJSON();
    }
    return value;
  }

  private extractBlocks(doc: Y.Doc): BlockData[] {
    const results: BlockData[] = [];

    try {
      const blocks = doc.getMap('blocks');
      if (!blocks) return results;

      // ⚠️ 親は**先に一度だけ**引き当てる。ブロックごとに全体を探すと、
      // ブロック数の**二乗**に比例して遅くなる（1000ブロックで100万回）
      const parents = this.buildParentMap(blocks);

      for (const [blockId, value] of blocks.entries()) {
        if (!(value instanceof Y.Map)) continue;

        const flavour = value.get('sys:flavour') as string | undefined;
        if (!flavour) continue;

        // #91: データベースブロックはセルの値が prop:cells に入るため、
        // prop:text / prop:title だけでは中身を拾えない。
        const parts = [this.extractText(value)];
        if (flavour === 'affine:database') {
          parts.push(this.extractDatabaseText(value));
        }
        const content = parts.filter(Boolean).join(' ');

        // #101: 参照先は1ブロックに複数ありうるため、参照ごとに1行にする。
        // 1行に詰めると「どのリンクか」を返せず、バックリンクの一覧が作れない
        const refs = this.extractRefDocIds(value, flavour);
        const parent = parents.get(blockId);

        for (const refDocId of refs) {
          results.push({
            blockId,
            blockType: flavour,
            content,
            refDocId,
            parentBlockId: parent?.blockId,
            parentFlavour: parent?.flavour,
            markdownPreview: this.buildLinkPreview(content, flavour),
          });
        }

        // #248: キャンバス（エッジレス）の文字は `surface` の要素に入る。
        // ブロックではないので、ここで別に拾う
        if (flavour === 'affine:surface') {
          results.push(...this.extractSurfaceTexts(blockId, value));
          continue;
        }

        // 参照が無い場合は、これまでどおり中身がある行だけを載せる
        if (refs.length === 0 && content) {
          results.push({
            blockId,
            blockType: flavour,
            content,
            parentBlockId: parent?.blockId,
            parentFlavour: parent?.flavour,
          });
        }
      }
    } catch (err) {
      this.logger.warn(`Block extraction failed: ${err}`);
    }

    return results;
  }

  /**
   * #248: キャンバス（エッジレス）の文字を取り出す。
   *
   * ⚠️ **`surface` の要素はブロックではない。** ブロックを辿るだけの走査では
   * 図形のラベルも線のラベルも拾えず、**フロー図の中身がまるごと検索から漏れる**
   * （2026-09-19 に実機で確認。docs/search-index.md 3-b）。
   *
   * ```
   *   affine:surface
   *     prop:elements（Y.Map。実データでは value を1段挟むこともある）
   *       ├─ { type: 'brush' }                    ← 文字なし
   *       ├─ { type: 'shape', text: Y.Text }      ← 図形のラベル
   *       └─ { type: 'frame', title: Y.Text }     ← フレーム名
   * ```
   *
   * ⚠️ **要素ごとに1行にする。** まとめると、検索結果でどの図形が当たったのか分からない。
   */
  private extractSurfaceTexts(
    surfaceId: string,
    surface: Y.Map<any>,
  ): BlockData[] {
    const results: BlockData[] = [];

    const raw = surface.get('prop:elements');
    if (!(raw instanceof Y.Map)) return results;
    // 実データには prop:elements.value に本体が入る形もある
    const inner = raw.get('value');
    const elements = inner instanceof Y.Map ? inner : raw;

    elements.forEach((element: unknown, key: string) => {
      if (!(element instanceof Y.Map)) return;

      // 文字は text（図形・線）か title（フレーム・グループ）に入る
      const text = this.readSurfaceText(element, 'text')
        ?? this.readSurfaceText(element, 'title');
      if (!text) return;

      const type = element.get('type');
      results.push({
        // ⚠️ **実在するブロックの ID を返すこと。** 検索結果を押すと
        // `openDoc({ blockIds: [blockId] })` に渡されるため、架空の ID だと
        // **その場所へ移動できない**（レビュー指摘・2026-09-19）。
        // surface の要素はブロックではないので、surface ブロック自身を指す
        blockId: surfaceId,
        blockType: `surface:${typeof type === 'string' ? type : 'unknown'}`,
        content: text,
        // どの要素が当たったかは失わない。画面へ渡せるようにするのは今後
        additional: JSON.stringify({ elementId: key }),
      });
    });

    return results;
  }

  /** surface の要素が持つ文字。Y.Text と素の文字列の両方がありうる。 */
  private readSurfaceText(
    element: Y.Map<any>,
    field: string,
  ): string | undefined {
    const value = element.get(field);
    if (value instanceof Y.Text) {
      const text = value.toString().trim();
      return text || undefined;
    }
    if (typeof value === 'string') {
      const text = value.trim();
      return text || undefined;
    }
    return undefined;
  }

  /**
   * #101: このブロックが参照しているページの一覧。
   *
   * | 種類 | どこに入るか |
   * |---|---|
   * | 本文中のリンク | 文字（`prop:text`）の装飾 `reference.pageId` |
   * | 埋め込みページ | `prop:pageId` |
   */
  private extractRefDocIds(block: Y.Map<any>, flavour: string): string[] {
    const refs: string[] = [];

    if (EMBED_DOC_FLAVOURS.has(flavour)) {
      const pageId = block.get('prop:pageId');
      if (typeof pageId === 'string' && pageId) refs.push(pageId);
    }

    const text = block.get('prop:text');
    if (text instanceof Y.Text) {
      for (const delta of text.toDelta()) {
        const reference = delta?.attributes?.reference;
        const pageId = reference?.pageId;
        if (typeof pageId === 'string' && pageId) refs.push(pageId);
      }
    }

    // 同じページへの複数のリンクは1行にまとめる
    return [...new Set(refs)];
  }

  /**
   * #101: バックリンクの一覧に出す文。
   *
   * リンクだけのブロック（本文が無い）でも、何が参照しているか分かるようにする。
   */
  private buildLinkPreview(content: string, flavour: string): string {
    const text = content.trim();
    if (text) return text;
    // 本文が無いリンク。ブロックの種類が分かれば、画面で位置を追える
    return flavour === 'affine:embed-linked-doc' ||
      flavour === 'affine:embed-synced-doc'
      ? '（埋め込みページ）'
      : '（リンク）';
  }

  /**
   * 子ブロック → 親ブロック の対応表。
   * 画面はこれで「どの段落からのリンクか」を示す。
   *
   * ```
   * note-1 ─ sys:children ─▶ [block-1, block-2]
   *   となれば block-1 → note-1、block-2 → note-1
   * ```
   */
  private buildParentMap(
    blocks: Y.Map<any>
  ): Map<string, { blockId: string; flavour: string }> {
    const parents = new Map<string, { blockId: string; flavour: string }>();

    for (const [parentId, value] of blocks.entries()) {
      if (!(value instanceof Y.Map)) continue;

      const children = value.get('sys:children');
      if (!(children instanceof Y.Array)) continue;

      const parent = {
        blockId: parentId,
        flavour: (value.get('sys:flavour') as string) ?? '',
      };
      for (const childId of children.toArray()) {
        if (typeof childId === 'string') parents.set(childId, parent);
      }
    }

    return parents;
  }

  private extractText(block: Y.Map<any>): string | undefined {
    // Try prop:text (most common text field in AFFiNE blocks)
    const propText = block.get('prop:text');
    if (propText instanceof Y.Text) {
      const text = propText.toString().trim();
      if (text) return text;
    }

    // Try prop:title (page blocks)
    const propTitle = block.get('prop:title');
    if (propTitle instanceof Y.Text) {
      const text = propTitle.toString().trim();
      if (text) return text;
    }

    return undefined;
  }
}
