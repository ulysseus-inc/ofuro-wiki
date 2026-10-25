import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { CliError } from '../errors';

/** 1ファイルの上限（取り出しと同じ。設計書 §6.8・§6.9） */
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

/** 先頭バイト → 形式。拡張子は見ない（テキストのファイルを画像として送らせない） */
const SIGNATURES: Array<{ mime: string; match: (b: Uint8Array) => boolean }> = [
  {
    mime: 'image/png',
    match: b => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { mime: 'image/jpeg', match: b => startsWith(b, [0xff, 0xd8, 0xff]) },
  { mime: 'image/gif', match: b => startsWith(b, [0x47, 0x49, 0x46, 0x38]) },
  {
    // RIFF....WEBP
    mime: 'image/webp',
    match: b =>
      startsWith(b, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  },
];

/** Markdown の画像。例: `![説明](./a.png)`、`![](<a b.png> "題")` */
const IMAGE_REF =
  /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/g;

/** コードブロック（``` / ~~~）とインラインコード。この中の `![](…)` は画像ではない */
const CODE_FENCE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;
const INLINE_CODE = /`[^`\n]*`/g;

/** 取りに行く種類の URL。ローカルファイルとしては扱わない（外部送信ゼロ） */
const REMOTE = /^(?:https?:|data:|blob:)/i;

export interface LocalImage {
  /** Blob の鍵。中身の SHA-256 の base64url（ブラウザ・サーバーと同じ） */
  key: string;
  data: Uint8Array;
  mime: string;
  /** 書かれていたとおりのパス。例: `./img/a.png` */
  ref: string;
}

/**
 * ページに追加するローカルの画像（設計書 §6.9）。
 *
 * 読んだ画像は送るまでここに貯める（`pending`）。送るのは呼び出し側で、
 * **本文より先に送る**（本文だけ届くと、画像の無い画像ブロックが残る）。
 */
export class LocalImages {
  private readonly byKey = new Map<string, LocalImage>();

  /** `baseDir` は相対パスの基準（Markdown ファイルの場所か、カレントディレクトリ） */
  constructor(
    private readonly baseDir: string,
    private readonly maxBytes = MAX_IMAGE_BYTES
  ) {}

  /**
   * 名指しされた画像ファイル（`image add --file`・`image` 操作）を読む。場所は問わない。
   * AI が名指しし、dry-run で利用者に見せる操作のため
   */
  add(ref: string): LocalImage {
    return this.load(ref, this.locate(ref));
  }

  /**
   * Markdown の中の画像を読む。**Markdown の場所かカレントディレクトリの配下だけ**。
   *
   * ⚠️ Markdown は AI が書く（ページの本文に書かれた指示に従うこともある）。
   * `![](/home/…/private.png)` で手元の私的な画像を wiki に上げさせない。
   * シンボリックリンクは実体の場所で判定する
   */
  addFromMarkdown(ref: string): LocalImage {
    const file = this.locate(ref);
    const real = realpath(file);
    const roots = [this.baseDir, process.cwd()].map(realpath);
    if (!roots.some(root => isInside(real, root))) {
      throw new CliError(
        `Markdown の場所かカレントディレクトリの外の画像は読まない: ${ref}`,
        '画像を Markdown の近くに置くか、ofuro image add --file で名指しする'
      );
    }
    return this.load(ref, file);
  }

  /** 相対パスを解決する。デコードした名前で無ければ、書かれたとおりの名前も試す（例: `a%20b.png`） */
  private locate(ref: string): string {
    const decoded = path.resolve(this.baseDir, safeDecode(ref));
    if (fs.existsSync(decoded)) {
      return decoded;
    }
    return path.resolve(this.baseDir, ref);
  }

  /** 形式・大きさを確かめて貯める。⚠️ 大きさと種類は読む前に見る（巨大なファイル・デバイスでメモリを使い切らない） */
  private load(ref: string, file: string): LocalImage {
    const stat = statOf(file);
    if (!stat?.isFile()) {
      throw new CliError(
        `画像ファイルを読めない: ${ref}`,
        `パスを確かめる（基準: ${this.baseDir}）`
      );
    }
    if (stat.size > this.maxBytes) {
      throw new CliError(
        `大きすぎる: ${ref}（${stat.size} バイト。上限 ${this.maxBytes}）`
      );
    }
    const data = fs.readFileSync(file);
    const mime = SIGNATURES.find(s => s.match(data))?.mime;
    if (!mime) {
      throw new CliError(
        `画像として読めない: ${ref}（PNG / JPEG / GIF / WebP のみ。SVG は不可）`
      );
    }

    const key = createHash('sha256').update(data).digest('base64url');
    const image = this.byKey.get(key) ?? { key, data, mime, ref };
    this.byKey.set(key, image);
    return image;
  }

  /** Markdown の中のローカルの画像の参照（書かれていたとおり） */
  refsIn(markdown: string): string[] {
    const refs: string[] = [];
    // ⚠️ コードの中の記法は画像ではない（書き方の説明として書かれることがある）
    const prose = markdown.replace(CODE_FENCE, '').replace(INLINE_CODE, '');
    for (const m of prose.matchAll(IMAGE_REF)) {
      const ref = m[1] ?? m[2];
      if (ref && !REMOTE.test(ref) && !refs.includes(ref)) {
        refs.push(ref);
      }
    }
    return refs;
  }

  /** 鍵 → 書かれていたパス（`update` が `image` 操作を作るときに使う） */
  refOf(key: string): string | undefined {
    return this.byKey.get(key)?.ref;
  }

  /** 送る画像。同じ中身は1回だけ */
  pending(): LocalImage[] {
    return [...this.byKey.values()];
  }
}

function statOf(file: string): fs.Stats | undefined {
  try {
    return fs.statSync(file);
  } catch {
    return undefined;
  }
}

/** 実体のパス。無ければそのまま（読む段で「読めない」にする） */
function realpath(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

function isInside(file: string, root: string): boolean {
  const rel = path.relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((v, i) => bytes[i] === v);
}

function safeDecode(ref: string): string {
  try {
    return decodeURIComponent(ref);
  } catch {
    return ref;
  }
}
