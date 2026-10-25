import { Text } from '@blocksuite/affine/store';

import { type LoadedDoc, loadDoc, newId, strict } from '../convert/blocksuite';
import type { LocalImages } from '../convert/local-images';
import { MarkdownCodec } from '../convert/markdown';
import {
  formatPage,
  NOTE_FLAVOUR,
  PAGE_FLAVOUR,
  type RenderedPage,
  renderPage,
} from '../convert/render';
import { CliError, notFound } from '../errors';
import type { LedgerDoc } from './ledger';
import type { Session } from './session';
import type { Space } from './space';

const SURFACE_FLAVOUR = 'affine:surface';
const PARAGRAPH_FLAVOUR = 'affine:paragraph';

/** 1ページ分の Store と変換器。読み・編集・送信の単位 */
export class Page {
  private constructor(
    readonly space: Space,
    readonly docId: string,
    readonly doc: LoadedDoc,
    readonly codec: MarkdownCodec,
    readonly ledgerDoc: LedgerDoc | null
  ) {}

  get store() {
    return this.doc.store;
  }

  /**
   * サーバーから最新の全状態（未統合の差分を含む）を取って開く（設計書 G4）。
   *
   * ⚠️ 台帳に無いページは開かない。ブラウザも一覧に無いページは開けない。
   */
  static async open(
    session: Session,
    space: Space,
    docId: string
  ): Promise<Page> {
    const docs = await space.ledger.documents();
    const ledgerDoc = docs.find(d => d.id === docId);
    if (!ledgerDoc) {
      throw notFound(docId);
    }

    const sync = await session.syncFor(space.id);
    const state = await sync.loadDoc(space.id, docId);
    if (!state) {
      throw notFound(docId);
    }

    const doc = loadDoc(docId, state);
    if (!doc.store.root) {
      throw notFound(docId);
    }
    return new Page(space, docId, doc, codecFor(space, docs), ledgerDoc);
  }

  /**
   * 新しいページの骨組み（page → surface / note）を手元に作る。
   * ブラウザの新規作成と同じ形（frontend の initDocFromProps）。
   */
  static async build(
    space: Space,
    docId: string,
    title: string,
    markdown: string,
    images?: LocalImages
  ): Promise<Page> {
    const docs = await space.ledger.documents();
    const page = new Page(
      space,
      docId,
      loadDoc(docId),
      codecFor(space, docs),
      null
    );
    if (images) {
      page.codec.useImages(images);
    }
    const { store } = page;

    const rootId = store.addBlock(PAGE_FLAVOUR, { title: new Text(title) });
    store.addBlock(SURFACE_FLAVOUR, {}, rootId);
    const noteId = store.addBlock(NOTE_FLAVOUR, {}, rootId);

    await strict(async () => {
      const snapshots = await page.codec.parse(markdown);
      for (const [index, snapshot] of snapshots.entries()) {
        await page.codec.insert(store, snapshot, noteId, index);
      }
      if (snapshots.length === 0) {
        store.addBlock(PARAGRAPH_FLAVOUR, {}, noteId);
      }
    });
    return page;
  }

  /** ブラウザと同じ形式の ID（nanoid） */
  static newId(): string {
    return newId();
  }

  render(): Promise<RenderedPage> {
    return renderPage(this.docId, this.store, this.codec);
  }

  async format(url: string): Promise<string> {
    return formatPage(await this.render(), url);
  }

  /**
   * 読み込んだローカルの画像を送る（#278）。送った数を返す。
   * ⚠️ 本文（push）より先に呼ぶ。本文だけ届くと、画像の無い画像ブロックが残る
   */
  async uploadImages(): Promise<number> {
    const pending = this.codec.images?.pending() ?? [];
    for (const image of pending) {
      await this.space.uploadBlob(image.key, image.data, image.mime);
    }
    return pending.length;
  }

  /** 開いてから加えた変更を1回の push で送る。変更が無ければ何もしない */
  async push(session: Session): Promise<boolean> {
    const update = this.doc.takeUpdate();
    if (!update) {
      return false;
    }
    const sync = await session.syncFor(this.space.id);
    await sync.pushUpdate(this.space.id, this.docId, update);
    return true;
  }
}

/** ページ参照を題付きのリンクで出すため、台帳の題を渡す */
function codecFor(space: Space, docs: LedgerDoc[]): MarkdownCodec {
  const titles = new Map(docs.map(d => [d.id, d.title]));
  return new MarkdownCodec(space.url, titles);
}

/** 作成の途中で失敗したときの案内（設計書 §7） */
export function partialCreateError(docId: string, cause: unknown): CliError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new CliError(
    `台帳には登録したが本文を書けなかった: ${docId}（${reason}）`,
    `ofuro edit ${docId} で本文を書くか ofuro trash ${docId} で捨てる`
  );
}

/**
 * 先頭の h1 見出し。例: `# 設計方針` → `設計方針`（`##` 以下は含めない）。
 * 閉じの `#` は前に空白があるときだけ外す（CommonMark と同じ。`# C#` の `#` は題の一部）
 */
const H1 = /^#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;

/** 本文の先頭（空行を除く）が h1 見出しか。`update` で題を変えるかの判定に使う */
export function hasTitleHeading(markdown: string): boolean {
  const first = markdown.split('\n').find(line => line.trim() !== '');
  return first !== undefined && H1.test(first.replace(/\r$/, ''));
}

/**
 * 題と本文を分ける（#277）。
 *
 * リポジトリの Markdown は先頭に `# 題` を持つことが多く、そのまま登録すると
 * 題と見出しが二重に表示される。
 *
 * 例: `('# 設計方針\n本文')` → 題 `設計方針`・本文 `本文`
 *     `('# 設計方針\n本文', '設計方針')` → 同じ（題と同じ見出しは除く）
 */
export function splitTitle(
  markdown: string,
  title?: string
): { title: string; body: string } {
  const lines = markdown.split('\n');
  const first = lines.findIndex(line => line.trim() !== '');
  // ⚠️ CRLF の行末の \r を外して照合する（`.` は \r に一致しない）。本文の改行は元のまま残す
  const heading = first >= 0 ? H1.exec(lines[first].replace(/\r$/, '')) : null;
  const rest = () => lines.slice(first + 1).join('\n');

  if (title === undefined) {
    if (!heading) {
      throw new CliError(
        '--title が無い（本文の先頭に # 見出しも無い）',
        '--title で題を指定するか、本文の先頭に # 見出しを書く'
      );
    }
    return { title: heading[1], body: rest() };
  }

  if (heading && heading[1] === title.trim()) {
    return { title, body: rest() };
  }
  return { title, body: markdown };
}
