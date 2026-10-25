import fs from 'node:fs';
import path from 'node:path';

import type { BlockModel, Store } from '@blocksuite/affine/store';

import { CliError } from '../errors';

const IMAGE_FLAVOUR = 'affine:image';
const ATTACHMENT_FLAVOUR = 'affine:attachment';
const ASSET_FLAVOURS = new Set([IMAGE_FLAVOUR, ATTACHMENT_FLAVOUR]);

/** 1ファイルの上限。AI が読める大きさを超え、通信も長くなるため（設計書 §6.8） */
export const MAX_ASSET_BYTES = 50 * 1024 * 1024;

/**
 * 全部を取り出すときの件数・合計の上限。ページ内の画像ブロックは他人が作れるため、
 * 大きな画像を指すブロックを数百個混ぜられても、端末を埋めないようにする
 */
export const MAX_ASSET_COUNT = 100;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

export interface AssetLimits {
  count: number;
  totalBytes: number;
}

const DEFAULT_LIMITS: AssetLimits = {
  count: MAX_ASSET_COUNT,
  totalBytes: MAX_TOTAL_BYTES,
};

/** 添付の元の名前の長さの上限（ファイル名が長すぎて保存できないのを避ける） */
const MAX_NAME_LENGTH = 100;

/** 形式 → 拡張子。無ければ `.bin` */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
};

/** 画像・添付ブロックが指すファイル。`read --json` の `asset` にも出す */
export interface Asset {
  blockId: string;
  flavour: string;
  /** Blob の鍵。アップロード中は無い */
  sourceId?: string;
  /** 添付の形式（画像は取得するまで分からない） */
  mime?: string;
  /** 添付の元の名前 */
  name?: string;
  width?: number;
  height?: number;
}

/** サーバーから Blob を取る（transport の BlobClient）。テストでは差し替える */
export type FetchBlob = (
  key: string
) => Promise<{ data: Uint8Array; mime: string }>;

/** 画像・添付ブロックなら、その中身の情報。それ以外は undefined */
export function assetOf(model: BlockModel): Asset | undefined {
  if (!ASSET_FLAVOURS.has(model.flavour)) {
    return undefined;
  }
  const props = model.props as Record<string, unknown>;
  const asset: Asset = { blockId: model.id, flavour: model.flavour };
  if (typeof props.sourceId === 'string' && props.sourceId) {
    asset.sourceId = props.sourceId;
  }
  if (model.flavour === ATTACHMENT_FLAVOUR) {
    if (typeof props.type === 'string' && props.type) {
      asset.mime = props.type;
    }
    if (typeof props.name === 'string' && props.name) {
      asset.name = props.name;
    }
    return asset;
  }
  if (typeof props.width === 'number' && props.width > 0) {
    asset.width = props.width;
  }
  if (typeof props.height === 'number' && props.height > 0) {
    asset.height = props.height;
  }
  return asset;
}

/** ページ内の画像・添付を上から順に。編集不可の場所（マルチカラム等）の中も含む */
export function pageAssets(store: Store): Asset[] {
  const out: Asset[] = [];
  const walk = (model: BlockModel) => {
    const asset = assetOf(model);
    if (asset) {
      out.push(asset);
    }
    model.children.forEach(walk);
  };
  if (store.root) {
    walk(store.root);
  }
  return out;
}

/**
 * 保存するファイル名。画像は `<ブロックID>.<拡張子>`、添付は `<ブロックID>-<元の名前>`。
 *
 * ⚠️ 元の名前もブロック ID も他人が作れる（ID は Yjs で直接書ける）。
 * パスの区切り・制御文字を `_` にして、保存先の外へ書かせない（例: `../x` → `.._x`）
 */
export function fileName(asset: Asset, mime: string): string {
  if (asset.flavour === ATTACHMENT_FLAVOUR && asset.name) {
    // Windows で使えない文字（`: * ? " < > |`）も置き換える
    // eslint-disable-next-line no-control-regex
    const safe = asset.name.replace(/[/\\:*?"<>|\x00-\x1f\x7f]/g, '_');
    return `${safeId(asset.blockId)}-${safe.slice(0, MAX_NAME_LENGTH)}`;
  }
  const ext = EXTENSIONS[mime.split(';')[0].trim().toLowerCase()] ?? 'bin';
  return `${safeId(asset.blockId)}.${ext}`;
}

/**
 * 画像・添付を `dir` に保存する。
 *
 * - ID を指定したとき: 1つでも失敗したら、その回に保存した分を消して例外（パスを出せないファイルを残さない）
 * - ID を省いたとき（全部）: 失敗したものは飛ばして `skipped` に入れる。ページ内の画像は
 *   他人が作れるので、壊れた・大きすぎる画像を1つ混ぜられただけで全体を止めない
 *
 * ⚠️ 呼び出し側はページを開いてから呼ぶこと。鍵はそのページの中から取る
 * （ページを読めない人に画像を渡さない。設計書 §6.8）
 */
export async function saveAssets(
  store: Store,
  blockIds: string[],
  dir: string,
  fetchBlob: FetchBlob,
  limits: AssetLimits = DEFAULT_LIMITS
): Promise<{
  saved: string[];
  skipped: Array<{ blockId: string; reason: string }>;
}> {
  // ⚠️ ディレクトリの作成は別に包む。保存先がファイルだと EEXIST になり、
  // 「既にある（上書きしない）」と取り違えるため
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    throw cannotSave(dir, e);
  }
  const saved: string[] = [];
  const skipped: Array<{ blockId: string; reason: string }> = [];

  if (blockIds.length === 0) {
    const seen = new Set<string>();
    let total = 0;
    for (const asset of pageAssets(store).filter(a => a.sourceId)) {
      const reason = seen.has(asset.sourceId as string)
        ? '同じ画像を取り出し済み'
        : saved.length >= limits.count || total >= limits.totalBytes
          ? `上限（${limits.count} 件・合計 ${limits.totalBytes} バイト）を超えた`
          : null;
      if (reason) {
        skipped.push({ blockId: asset.blockId, reason });
        continue;
      }
      seen.add(asset.sourceId as string);
      try {
        const file = await saveOne(asset, dir, fetchBlob);
        saved.push(file);
        total += fs.statSync(file).size;
      } catch (e) {
        skipped.push({
          blockId: asset.blockId,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { saved, skipped };
  }

  const targets = [...new Set(blockIds)].map(id => requireAsset(store, id));
  try {
    for (const asset of targets) {
      saved.push(await saveOne(asset, dir, fetchBlob));
    }
  } catch (e) {
    saved.forEach(file => fs.rmSync(file, { force: true }));
    throw e;
  }
  return { saved, skipped };
}

async function saveOne(
  asset: Asset,
  dir: string,
  fetchBlob: FetchBlob
): Promise<string> {
  const { data, mime } = await fetchBlob(asset.sourceId as string);
  // 取得側（BlobClient）でも打ち切るが、差し替えた取得（テスト等）にも上限を効かせる
  if (data.length > MAX_ASSET_BYTES) {
    throw new CliError(
      `大きすぎる: ${asset.blockId}（${data.length} バイト。上限 ${MAX_ASSET_BYTES}）`,
      '利用者にブラウザで開いてもらう'
    );
  }
  // ⚠️ 名前を無害化したうえで、書く直前にも保存先の中かを確かめる（二重の守り）
  const base = path.resolve(dir);
  const file = path.resolve(base, fileName(asset, asset.mime ?? mime));
  if (path.dirname(file) !== base) {
    throw new CliError(`不正なファイル名: ${asset.blockId}`);
  }
  writable(() => fs.writeFileSync(file, data, { flag: 'wx' }), file);
  return file;
}

/** ブロック ID のうち、ファイル名に使える文字（英数字・`_`・`-`・`.`）だけを残す */
function safeId(blockId: string): string {
  return blockId.replace(/[^A-Za-z0-9_.-]/g, '_');
}

/**
 * ファイルの書き込み。失敗（既にある・権限・ディスク満杯・保存先がファイル等）を
 * 案内付きのエラーにする。生の例外だと AI が次にすべきことが分からない
 */
function writable(write: () => void, target: string): void {
  try {
    write();
  } catch (e) {
    if ((e as { code?: string }).code === 'EEXIST') {
      throw new CliError(
        `既にある: ${target}`,
        '--out で空のディレクトリを指定するか、--out を省く'
      );
    }
    throw cannotSave(target, e);
  }
}

function cannotSave(target: string, cause: unknown): CliError {
  return new CliError(
    `保存できない: ${target}（${(cause as Error).message}）`,
    '--out の場所と空き容量を確かめる'
  );
}

function requireAsset(store: Store, blockId: string): Asset {
  const model = store.getBlock(blockId)?.model;
  if (!model) {
    throw new CliError(
      `ブロックが無い: ${blockId}`,
      'ofuro read で ID を確かめる'
    );
  }
  const asset = assetOf(model);
  if (!asset) {
    throw new CliError(
      `画像・添付ではない: ${blockId}（${model.flavour}）`,
      'ofuro read で [image] / [attachment] のブロック ID を確かめる'
    );
  }
  if (!asset.sourceId) {
    throw new CliError(
      `まだアップロード中で取り出せない: ${blockId}`,
      'しばらく待ってから再実行する'
    );
  }
  return asset;
}
