/**
 * #77: root（`ROOT_EMAIL`）の判定を1箇所に集約する。
 *
 * 起動時のシード（AdminService.seedAdmin）と、サインアップ時の付与
 * （AuthService.signUp）で判定がずれないようにするため。
 */

/** 設定値。空白だけなら undefined */
function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// ⚠️ 変数名を書いて読む（`process.env[name]` にしない）。compose が渡しているかの検査
// （test/common/compose-env.spec.ts）は、この書き方から変数を拾う。
function readRoot(): string | undefined {
  return normalize(process.env.ROOT_EMAIL);
}

/**
 * #297: v0.2 までの名前。古い `.env` のまま更新しても root が居なくならないよう、
 * 1.0.0 までは読む（docs/workspace-model.md 12.1.1）
 */
function readLegacy(): string | undefined {
  return normalize(process.env.ADMIN_EMAIL);
}

/** 設定された root のアドレス（未設定なら undefined）。ROOT_EMAIL を優先する */
export function getAdminEmail(): string | undefined {
  return readRoot() ?? readLegacy();
}

/**
 * #297: 起動時に、新旧の名前の設定を確かめる（docs/workspace-model.md 12.1.1）。
 *
 * - 両方に違う値: 投げる（どちらが root か決められないまま動かさない）
 * - 古い名前が残っている: 起動ログに出す警告を返す
 * - それ以外: undefined
 */
export function checkRootEmailEnv(): string | undefined {
  const root = readRoot();
  const legacy = readLegacy();

  if (!legacy) {
    return undefined;
  }

  if (!root) {
    return 'ADMIN_EMAIL is deprecated. Rename it to ROOT_EMAIL in .env';
  }

  if (root !== legacy) {
    throw new Error(
      'ROOT_EMAIL and ADMIN_EMAIL differ. Remove ADMIN_EMAIL from .env',
    );
  }

  return 'ADMIN_EMAIL is ignored (same as ROOT_EMAIL). Remove it from .env';
}

/**
 * 指定のメールアドレスが root（ROOT_EMAIL）かどうか。
 *
 * ⚠️ **完全一致で判定する（大文字小文字を区別する）。**
 *
 * `users.email` は大文字小文字を区別する一意制約であり、`ADMIN@example.com` と
 * `admin@example.com` は別アカウントとして登録できる。ここで大文字小文字を無視すると、
 * **第三者が ROOT_EMAIL の大文字小文字違いでサインアップするだけで管理者になれる**
 * （サインアップの重複チェックは完全一致のため素通りする）。
 *
 * 「設定と違う大文字小文字でサインアップすると管理者にならない」という不便さは残るが、
 * 権限昇格を許すよりはるかに安全で、`.env` の値を直せば解決できる。
 */
export function isAdminEmail(email: string): boolean {
  const adminEmail = getAdminEmail();
  if (!adminEmail || !email) return false;

  // ⚠️ 入力側は trim しない。DBに保存される文字列そのもので判定する。
  // trim すると `"admin@example.com "`（末尾に空白）で登録された別アカウントが
  // 一致してしまい、大文字小文字と同じ経路で権限昇格を許す。
  // （現状は DTO の @IsEmail が空白付きを弾くが、そこに依存しない）
  // 設定値側の空白は getAdminEmail() で除去済み（.env の書式ゆれの吸収）。
  return email === adminEmail;
}
