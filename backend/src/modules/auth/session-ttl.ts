/**
 * #332: サインインの期限（docs/signin-registration.md 7 章）。
 *
 * トークン（JWT の exp）とクッキー（maxAge）の両方をここから作る。
 * 片方だけ変えると、クッキーが残っているのにトークンが切れている状態になる。
 */
export const SESSION_TTL_DAYS = 30;

const SECONDS_PER_DAY = 24 * 60 * 60;

/** JWT の expiresIn に渡す秒数 */
export const SESSION_TTL_SECONDS = SESSION_TTL_DAYS * SECONDS_PER_DAY;

/** クッキーの maxAge に渡すミリ秒 */
export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
