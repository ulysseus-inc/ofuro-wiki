import * as crypto from 'crypto';
import type { Response } from 'express';

/**
 * #89: 認証クッキーの設定を1箇所に集約する。
 *
 * パスワード認証（auth.controller）と OIDC（oidc.controller）の両方から使う。
 * 別々に実装すると、片方だけ Secure 属性や有効期限がずれる、といった事故が起きる。
 */

// COOKIE_SECURE=false で HTTP 環境でも動作可能（デフォルト: 本番は true）
const cookieSecure =
  process.env.COOKIE_SECURE !== undefined
    ? process.env.COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production';

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

/** 認証トークンと CSRF トークンのクッキーを発行する。 */
export function setAuthCookies(res: Response, token: string): void {
  res.cookie('affine_token', token, COOKIE_OPTIONS);

  const csrfToken = crypto.randomBytes(32).toString('hex');
  res.cookie('affine_csrf_token', csrfToken, {
    ...COOKIE_OPTIONS,
    // CSRF トークンは JS から読める必要がある（ヘッダに載せて送り返すため）
    httpOnly: false,
  });
}

/** サインアウト時にクッキーを消す。 */
export function clearAuthCookies(res: Response): void {
  res.clearCookie('affine_token');
  res.clearCookie('affine_csrf_token');
}

/**
 * #89: OIDC の `state` をブラウザに束縛するためのクッキー。
 *
 * ## なぜ必要か（ログイン CSRF の防止）
 *
 * `state` をサーバー側に保持するだけでは、**どのブラウザが認証を開始したか**を
 * 確認できない。攻撃者が自分で認証を開始して有効な `code` と `state` を取得し、
 * 被害者に `/oauth/callback?code=...&state=...` を踏ませると、
 * **被害者が攻撃者のアカウントでサインインさせられる**（以後の入力が攻撃者の
 * アカウントに保存される）。
 *
 * 認証開始時に httpOnly クッキーへ `state` を書き、コールバックで一致を確認することで、
 * 「開始したブラウザ」と「戻ってきたブラウザ」が同一であることを保証する。
 *
 * httpOnly にするのは、XSS でこの値を読み出されないようにするため。
 */
export const OIDC_STATE_COOKIE = 'ofuro_oidc_state';

/** IdP での認証にかかる時間を考慮した有効期間（サーバー側の state と揃える） */
const OIDC_STATE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * 認証開始時の `state` をブラウザに記録する。
 *
 * ⚠️ **試行ごとに別名のクッキーを使う。**
 * 1つのクッキーを共有すると、認証が同時に2つ始まったとき
 * （開発時の React StrictMode による effect の二重実行、ボタンの2度押し、
 * 複数タブなど）に読み書きが競合し、先に始めた方の state が消える。
 * 消えた側は「サインインできませんでした」となり、利用者からは
 * 原因が分からないまま失敗が繰り返される。
 *
 * 名前を state から導出することで、互いに干渉しなくなる。
 * 攻撃者は当サイトのオリジンにクッキーを設定できないため、
 * 「このブラウザが開始した認証である」ことの証明としては同じ強度を保つ。
 */
export function oidcStateCookieName(state: string): string {
  const digest = crypto
    .createHash('sha256')
    .update(state)
    .digest('hex')
    .slice(0, 16);
  return `${OIDC_STATE_COOKIE}_${digest}`;
}

export function setOidcStateCookie(res: Response, state: string): void {
  res.cookie(oidcStateCookieName(state), state, {
    httpOnly: true,
    secure: cookieSecure,
    // IdP からのリダイレクト（トップレベルの GET 遷移）でも送出される必要があるため lax
    sameSite: 'lax',
    path: '/',
    maxAge: OIDC_STATE_MAX_AGE_MS,
  });
}

/**
 * 進行中の state クッキーをすべて片付ける。
 *
 * 途中で離脱した試行のクッキーは、コールバックに到達しないため個別には
 * 消えず、有効期限（10分）まで残る。リトライを繰り返すと Cookie ヘッダが
 * 膨らんでいくので、サインインが決着した時点でまとめて消す。
 */
export function clearAllOidcStateCookies(
  res: Response,
  cookies: Record<string, string> | undefined,
): void {
  for (const name of Object.keys(cookies ?? {})) {
    if (name.startsWith(`${OIDC_STATE_COOKIE}_`)) {
      res.clearCookie(name, { path: '/' });
    }
  }
}
