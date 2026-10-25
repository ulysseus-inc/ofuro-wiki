import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LocalImages } from '../convert/local-images';
import { saveAssets } from '../domain/assets';
import { type ImageOp, parseOps } from '../domain/ops';
import { Page } from '../domain/page';
import type { Session } from '../domain/session';
import { CliError } from '../errors';
import { type Args, option, requirePositional } from './args';
import { assertNotTrashed, modeOf, send } from './pages';

/** 既定の保存先の頭。実行ごとに新しいディレクトリを作る */
const TEMP_PREFIX = 'ofuro-image-';

/** `ofuro image (get | add) ...` */
export async function image(session: Session, args: Args): Promise<string> {
  const action = requirePositional(args, 0, '操作（get / add）');
  switch (action) {
    case 'get':
      return getImages(session, args);
    case 'add':
      return addImage(session, args);
    default:
      throw new CliError(`不明な操作: ${action}`, 'ofuro help image');
  }
}

/**
 * `ofuro image add <docId> --file <画像> [--after | --before | --parent <ID>] [--caption <文>] [--dry-run]`
 *
 * edit の image 操作1つと同じ（設計書 §6.9）。位置・dry-run・送信は edit と共通
 */
async function addImage(session: Session, args: Args): Promise<string> {
  const { space, docId } = await session.resolveDoc(
    requirePositional(args, 1, 'docId')
  );
  const file = option(args, 'file');
  if (!file) {
    throw new CliError('--file が要る', '追加する画像ファイルのパスを渡す');
  }
  const op: ImageOp = { op: 'image', file };
  for (const key of ['after', 'before', 'parent', 'caption'] as const) {
    const value = option(args, key);
    if (value !== undefined) {
      op[key] = value;
    }
  }
  // 位置の指定が2つ以上なら、edit と同じ形で拒む
  const [checked] = parseOps(JSON.stringify([op]));

  const page = await Page.open(session, space, docId);
  assertNotTrashed(page);
  page.codec.useImages(new LocalImages(process.cwd()));
  return send(session, page, [checked], modeOf(args));
}

/** `ofuro image get <docId> [<ブロックID>]... [--out <ディレクトリ>]` */
async function getImages(session: Session, args: Args): Promise<string> {
  const { space, docId } = await session.resolveDoc(
    requirePositional(args, 1, 'docId')
  );

  // ⚠️ 先にページを開く。読めないページの画像は取らない（鍵はページの中から取る）
  const page = await Page.open(session, space, docId);
  const out = option(args, 'out');
  const dir = out ?? fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  let saved: string[] = [];
  let skipped: Array<{ blockId: string; reason: string }> = [];
  try {
    ({ saved, skipped } = await saveAssets(
      page.store,
      args.positionals.slice(2),
      dir,
      space.fetchBlob
    ));
  } finally {
    // 自分で作った一時ディレクトリは、空なら（失敗・何も無い）消す
    if (!out && saved.length === 0) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const lines = [
    ...saved,
    ...skipped.map(s => `取り出せなかった: ${s.blockId}（${s.reason}）`),
  ];
  return lines.length > 0 ? lines.join('\n') : '（取り出せる画像・添付が無い）';
}
