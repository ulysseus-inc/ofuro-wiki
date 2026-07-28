/**
 * #77: `ADMIN_EMAIL` の判定を1箇所に集約する。
 *
 * 起動時のシード（AdminService.seedAdmin）と、サインアップ時の付与
 * （AuthService.signUp）で判定がずれないようにするため。
 */

/** 設定された ADMIN_EMAIL（未設定なら undefined） */
export function getAdminEmail(): string | undefined {
  const value = process.env.ADMIN_EMAIL?.trim();
  return value ? value : undefined;
}

/**
 * 指定のメールアドレスが ADMIN_EMAIL かどうか。
 *
 * ⚠️ **完全一致で判定する（大文字小文字を区別する）。**
 *
 * `users.email` は大文字小文字を区別する一意制約であり、`ADMIN@example.com` と
 * `admin@example.com` は別アカウントとして登録できる。ここで大文字小文字を無視すると、
 * **第三者が ADMIN_EMAIL の大文字小文字違いでサインアップするだけで管理者になれる**
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
