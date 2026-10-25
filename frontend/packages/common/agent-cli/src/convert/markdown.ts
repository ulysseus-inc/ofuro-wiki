import type {
  BlockModel,
  BlockSnapshot,
  Store,
  Transformer,
  TransformerMiddleware,
} from '@blocksuite/affine/store';

import { CliError } from '../errors';
import { createTransformer, getMarkdownAdapter } from './blocksuite';
import type { LocalImages } from './local-images';
import type { DeltaOp } from './text-diff';

const PARAGRAPH_FLAVOUR = 'affine:paragraph';
const IMAGE_FLAVOUR = 'affine:image';
const INLINE_PROBE_ID = 'inline';

/** スナップショット内で「これは Text」を示す印（blocksuite の決まり） */
const TEXT_MARKER = '$blocksuite:internal:text$';

/**
 * ブロック単位の Markdown 変換。
 *
 * 読み（Yjs → Markdown）も書き（Markdown → ブロック）も blocksuite の
 * MarkdownAdapter に任せる。記法を1か所に揃え、往復で崩れないようにするため
 * （設計書 §2.2「読取と書込で記法が非対称」の回避）。
 *
 * ページ参照はブラウザと同じ URL のリンクになる。
 * 例: `[設計書](https://wiki.example.com/workspace/<ws>/<docId>)`
 */
export class MarkdownCodec {
  private readonly transformer: Transformer;
  private localImages: LocalImages | null = null;

  constructor(workspaceUrl: string, titles: Map<string, string>) {
    this.transformer = createTransformer([
      linkMiddleware(workspaceUrl, titles),
    ]);
  }

  /** 子を含めない、そのブロックだけの Markdown（末尾の改行なし） */
  async blockToMarkdown(model: BlockModel): Promise<string> {
    const snapshot = this.transformer.blockToSnapshot(model);
    if (!snapshot) {
      return '';
    }
    snapshot.children = [];
    return this.snapshotToMarkdown(snapshot);
  }

  async snapshotToMarkdown(snapshot: BlockSnapshot): Promise<string> {
    const { file } = await getMarkdownAdapter(
      this.transformer
    ).fromBlockSnapshot({
      snapshot,
      assets: this.transformer.assetsManager,
    });
    return file.replace(/\n+$/, '');
  }

  /** ローカルの画像を読めるようにする（設計書 §6.9）。使わなければ画像は作れない */
  useImages(images: LocalImages): void {
    this.localImages = images;
  }

  get images(): LocalImages | null {
    return this.localImages;
  }

  /** Markdown → note 直下に並ぶブロックのスナップショット */
  async parse(markdown: string): Promise<BlockSnapshot[]> {
    this.registerImages(markdown);
    const note = await withoutNetwork(() =>
      getMarkdownAdapter(this.transformer).toBlockSnapshot({
        file: markdown,
        assets: this.transformer.assetsManager,
      })
    );
    const blocks = dropImageGaps(note.children);
    blocks.forEach(assertImagesResolved);
    return blocks;
  }

  /**
   * Markdown の中のローカルの画像を先に読み、「パス → 鍵」の表に入れる。
   * 変換はこの表から鍵を引く（ブラウザの zip 取り込みと同じ仕組み）ので、通信は起きない
   */
  private registerImages(markdown: string): void {
    if (!this.localImages) {
      return;
    }
    const assets = this.transformer.assetsManager;
    for (const ref of this.localImages.refsIn(markdown)) {
      const image = this.localImages.addFromMarkdown(ref);
      assets
        .getAssets()
        .set(image.key, new File([image.data], ref, { type: image.mime }));
      assets.getPathBlobIdMap().set(ref, image.key);
      assets.getPathBlobIdMap().set(safeDecode(ref), image.key);
    }
  }

  /** 表のセル等、ブロックでない文字列の Markdown。例: `**太字**` */
  async inlineToMarkdown(delta: DeltaOp[]): Promise<string> {
    return this.snapshotToMarkdown({
      type: 'block',
      id: INLINE_PROBE_ID,
      flavour: PARAGRAPH_FLAVOUR,
      props: { type: 'text', text: { [TEXT_MARKER]: true, delta } },
      children: [],
    });
  }

  /** `inlineToMarkdown` の逆。段落1つ分として読み、書式付きの文字列を返す */
  async parseInline(markdown: string): Promise<DeltaOp[]> {
    if (!markdown.trim()) {
      return [];
    }
    const [first, ...rest] = await this.parse(markdown);
    if (!first || rest.length > 0 || first.flavour !== PARAGRAPH_FLAVOUR) {
      throw new CliError(
        `1行の文字列として読めない: ${markdown}`,
        '改行・見出し・箇条書きを含めない'
      );
    }
    return snapshotDelta(first) ?? [];
  }

  /** スナップショットを `parent` の `index` 番目に作る。作ったブロックの ID を返す */
  async insert(
    store: Store,
    snapshot: BlockSnapshot,
    parentId: string,
    index: number
  ): Promise<string> {
    const model = await this.transformer.snapshotToBlock(
      snapshot,
      store,
      parentId,
      index
    );
    if (!model) {
      throw new Error(`ブロックを作れなかった: ${snapshot.flavour}`);
    }
    return model.id;
  }
}

/**
 * 変換中の通信を止める。
 *
 * ⚠️ MarkdownAdapter は `![](https://…)` を見ると画像を取りに行く。
 * AI の書いた URL へ勝手に通信させない（外部送信ゼロの方針）。
 * 画像は作れない種類なので、取りに行こうとした時点で拒む。
 */
let guardDepth = 0;
let fetchAttempts = 0;
let saved: { fetch: typeof fetch; console: Console } | null = null;

/**
 * ⚠️ 入れ子・並行に呼ばれても、最後の1つが抜けたときにだけ元へ戻す。
 * 呼ぶたびに「その時点の値」を控えて戻すと、並行した呼び出しが
 * 互いのスタブを「元の値」として戻し、fetch が止まったまま残る。
 */
async function withoutNetwork<T>(run: () => Promise<T>): Promise<T> {
  if (guardDepth++ === 0) {
    saved = { fetch: globalThis.fetch, console: globalThis.console };
    globalThis.fetch = () => {
      fetchAttempts++;
      return Promise.reject(new Error('network disabled'));
    };
    // 取得失敗を blocksuite が console に書くため、その間だけ黙らせる
    globalThis.console = { ...saved.console, warn: () => {}, error: () => {} };
  }
  const attemptsBefore = fetchAttempts;

  try {
    const result = await run();
    if (fetchAttempts !== attemptsBefore) {
      throw new CliError(
        '画像は追加できない',
        '画像は人がブラウザで貼る。Markdown から ![...](...) を除く'
      );
    }
    return result;
  } finally {
    if (--guardDepth === 0 && saved) {
      globalThis.fetch = saved.fetch;
      globalThis.console = saved.console;
      saved = null;
    }
  }
}

/**
 * ⚠️ 変換は画像の直前に空の段落を作る（画像は段落の中の要素として読まれ、外へ出される）。
 * Markdown では空の段落を書けないので、画像の直前の空の段落は除く
 */
function dropImageGaps(blocks: BlockSnapshot[]): BlockSnapshot[] {
  return blocks
    .filter(
      (block, i) =>
        !(isEmptyParagraph(block) && blocks[i + 1]?.flavour === IMAGE_FLAVOUR)
    )
    .map(block => ({ ...block, children: dropImageGaps(block.children) }));
}

function isEmptyParagraph(block: BlockSnapshot): boolean {
  if (block.flavour !== PARAGRAPH_FLAVOUR || block.children.length > 0) {
    return false;
  }
  return (snapshotDelta(block) ?? []).every(op => !op.insert);
}

/** 読み込めなかった画像（鍵が空）は作らない */
function assertImagesResolved(block: BlockSnapshot): void {
  if (block.flavour === IMAGE_FLAVOUR && !block.props.sourceId) {
    throw new CliError(
      '画像ファイルを読めない（ローカルの画像は ofuro image add か、--file の Markdown で追加する）',
      'パスを確かめる。外部 URL の画像は追加できない'
    );
  }
  block.children.forEach(assertImagesResolved);
}

function safeDecode(ref: string): string {
  try {
    return decodeURIComponent(ref);
  } catch {
    return ref;
  }
}

/** スナップショットの本文。本文を持たない種類（区切り線等）は undefined */
export function snapshotDelta(snapshot: BlockSnapshot): DeltaOp[] | undefined {
  const text = snapshot.props.text as { delta?: DeltaOp[] } | undefined;
  return text?.delta;
}

/** ページ参照を URL リンクとして読み書きするための設定 */
function linkMiddleware(
  workspaceUrl: string,
  titles: Map<string, string>
): TransformerMiddleware {
  return ({ adapterConfigs }) => {
    adapterConfigs.set('docLinkBaseUrl', workspaceUrl);
    for (const [docId, title] of titles) {
      adapterConfigs.set(`title:${docId}`, title);
    }
  };
}
