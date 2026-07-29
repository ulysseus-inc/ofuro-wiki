import * as crypto from 'crypto';

/**
 * #89: 管理画面から保存する秘密情報（OIDC のクライアントシークレット等）を暗号化する。
 *
 * ## なぜ暗号化するのか
 *
 * これらは「設定」であると同時に**パスワード相当**であり、平文で DB に置くと
 * バックアップ ZIP（pg_dump を含む）や DB ダンプが漏れた時点で悪用できてしまう。
 * アプリの外に出る成果物に平文を載せないため、保存時に暗号化する。
 *
 * ## 鍵について
 *
 * 鍵は `JWT_SECRET` から HKDF で派生させる（別用途の鍵を直接使い回さない）。
 * `.env`（＝起動に必要な情報）に鍵があり、DB に暗号文がある、という分担にすることで、
 * **DB 単体が漏れても復号できない**状態にする。
 *
 * ⚠️ `JWT_SECRET` を変更すると復号できなくなる（＝再設定が必要）。
 *    これは仕様であり、復号に失敗した場合は「未設定」として扱う。
 */

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc.v1.';
const IV_LENGTH = 12; // GCM の推奨長
const KEY_INFO = 'ofuro-wiki:server-setting:v1';

function getKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      '[ofuro-wiki] JWT_SECRET が未設定のため、秘密情報を暗号化できません',
    );
  }
  // HKDF で用途別の鍵を派生させる（JWT 署名鍵をそのまま暗号鍵に使わない）
  return Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), KEY_INFO, 32),
  );
}

/** 値を暗号化する。空文字はそのまま返す（未設定を維持するため）。 */
export function encryptSecret(plain: string): string {
  if (!plain) return '';

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // prefix + base64(iv | tag | ciphertext)
  return (
    PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64')
  );
}

/**
 * 値を復号する。
 *
 * - 暗号化されていない値（旧データ・手動投入）はそのまま返す
 * - 復号に失敗した場合（JWT_SECRET 変更後など）は null を返す＝「未設定」として扱う
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored;

  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, IV_LENGTH);
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
    const encrypted = raw.subarray(IV_LENGTH + 16);

    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // 鍵が変わった / データが壊れている。呼び出し側で「未設定」として扱わせる。
    return null;
  }
}
