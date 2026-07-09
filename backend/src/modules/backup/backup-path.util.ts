import * as path from 'path';

/**
 * L-4 (zip-slip) 対策のパス検証ユーティリティ。
 * バックアップ ZIP のエントリ名は信頼できない入力として扱う。
 */

/**
 * アーカイブ内エントリ名が安全な相対パスか判定する。
 * 絶対パス・`..` を含むもの・NUL 文字・バックスラッシュ経由の traversal を拒否する。
 */
export function isSafeArchiveEntry(entryPath: string): boolean {
  if (!entryPath || entryPath.includes('\0')) return false;
  // Windows 由来のバックスラッシュも区切りとみなして評価する
  const normalizedInput = entryPath.replace(/\\/g, '/');
  // POSIX（/... ）と Windows（C:\... / UNC）の両方の絶対パスを拒否する
  if (
    path.posix.isAbsolute(normalizedInput) ||
    path.win32.isAbsolute(normalizedInput)
  ) {
    return false;
  }
  const normalized = path.posix.normalize(normalizedInput);
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    return false;
  }
  return true;
}

/**
 * Blob キーの検証。キーはフロント/サーバ生成の base64url(RFC4648 §5) SHA256 で
 * あり、パス区切りや `..` を含まないため、厳格な許可リストで検証する。
 * これにより Blob 書き込み先パスの traversal を根絶する。
 */
export function isValidBlobKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(key);
}

/**
 * baseDir 配下に収まる絶対パスを返す。エスケープする場合は例外を投げる。
 * 展開先の封じ込め（zip-slip 防止）に使う。
 */
export function resolveWithinDir(baseDir: string, relativePath: string): string {
  const baseResolved = path.resolve(baseDir);
  const target = path.resolve(baseResolved, relativePath);
  // baseResolved がルート（/）や末尾セパレータ付きでも誤判定しないように整える
  const safePrefix = baseResolved.endsWith(path.sep)
    ? baseResolved
    : baseResolved + path.sep;
  if (target !== baseResolved && !target.startsWith(safePrefix)) {
    throw new Error(`Unsafe archive path escapes base directory: ${relativePath}`);
  }
  return target;
}
