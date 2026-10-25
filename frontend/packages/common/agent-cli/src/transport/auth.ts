import fs from 'node:fs';

import { CliError } from '../errors';
import { type Config, TOKEN_FILE, writePrivateFile } from './config';

const SIGN_IN_PATH = '/api/auth/sign-in';
const TOKEN_COOKIE = 'affine_token';
const HTTP_TOO_MANY_REQUESTS = 429;
/** 応答しないサーバーで AI が止まり続けないよう打ち切る */
export const HTTP_TIMEOUT_MS = 30_000;

export interface CachedToken {
  serverUrl: string;
  email: string;
  token: string;
}

/**
 * JWT の取得とキャッシュ（設計書 §4）。
 *
 * ⚠️ トークン・パスワードは標準出力にもエラー文にも出さない。
 */
export class Auth {
  private token: string | null = null;

  constructor(private readonly config: Config) {}

  /** キャッシュがあればそれを、無ければサインインして返す */
  async getToken(): Promise<string> {
    if (this.token) {
      return this.token;
    }

    const cached = this.readCache();
    if (cached) {
      this.token = cached;
      return cached;
    }
    return this.refresh();
  }

  /** 401 / 接続拒否のときに1回だけ呼ぶ。キャッシュを捨ててサインインし直す */
  async refresh(): Promise<string> {
    const { email, password } = this.config;
    if (!email) {
      throw new CliError(
        'ログインしていない',
        '利用者が自分の端末で ofuro login を実行する（パスワードを AI に渡さない）'
      );
    }
    // パスワードはローカルに保存しない（設計書 §4）。トークンが切れたら人がログインし直す
    if (!password) {
      throw new CliError(
        'トークンの期限が切れた（またはまだログインしていない）',
        '利用者が自分の端末で ofuro login を実行する（パスワードを AI に渡さない）'
      );
    }

    this.token = await signIn(this.config.serverUrl, email, password);
    writePrivateFile(
      TOKEN_FILE,
      JSON.stringify({
        serverUrl: this.config.serverUrl,
        email,
        token: this.token,
      } satisfies CachedToken)
    );
    return this.token;
  }

  /** 別のサーバー・別の人のトークンは使わない */
  private readCache(): string | null {
    if (!fs.existsSync(TOKEN_FILE)) {
      return null;
    }
    try {
      const cached = JSON.parse(
        fs.readFileSync(TOKEN_FILE, 'utf8')
      ) as CachedToken;
      return cachedTokenFor(cached, this.config.serverUrl, this.config.email);
    } catch {
      return null;
    }
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * localhost 以外へ平文でパスワードを送るときは警告する。
 * 拒否はしない（社内 LAN を HTTP で運用している場合があるため）
 */
function warnIfPlainHttp(serverUrl: string): void {
  const url = new URL(serverUrl);
  if (url.protocol !== 'http:' || LOCAL_HOSTS.has(url.hostname)) {
    return;
  }
  process.stderr.write(
    `警告: ${url.host} へ暗号化されていない HTTP でパスワードを送る。https:// の URL を使う\n`
  );
}

/** sign-in の Set-Cookie から JWT を取り出す */
export async function signIn(
  serverUrl: string,
  email: string,
  password: string
): Promise<string> {
  warnIfPlainHttp(serverUrl);
  const res = await fetch(`${serverUrl}${SIGN_IN_PATH}`, {
    method: 'POST',
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).catch(() => {
    throw new CliError(
      `サーバーに接続できない: ${serverUrl}`,
      'ワークスペース URL とネットワークを確かめる'
    );
  });

  if (res.status === HTTP_TOO_MANY_REQUESTS) {
    throw new CliError(
      'サインインの試行が多すぎる',
      '数分待ってから再実行する'
    );
  }
  if (!res.ok) {
    throw new CliError(
      `サインインに失敗した（HTTP ${res.status}）`,
      'メールアドレス・パスワードと、アカウントがパスワードログインを許可しているかを確かめる'
    );
  }

  const token = findCookie(res.headers.getSetCookie(), TOKEN_COOKIE);
  if (!token) {
    throw new CliError('サインイン応答にトークンが無い');
  }
  return token;
}

/** 例: `affine_token=abc; Path=/; HttpOnly` → `abc` */
export function findCookie(setCookies: string[], name: string): string | null {
  for (const line of setCookies) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq < 0) {
      continue;
    }
    if (pair.slice(0, eq).trim() !== name) {
      continue;
    }
    try {
      return decodeURIComponent(pair.slice(eq + 1).trim());
    } catch {
      throw new CliError('サインイン応答のトークンが読めない');
    }
  }
  return null;
}

/**
 * キャッシュのトークンを使ってよいか。サーバーとメールの両方が一致するときだけ。
 *
 * ⚠️ メールが未設定なら使わない。同じ OS ユーザーの別アカウントの
 * トークンで書き込むのを防ぐ。
 */
export function cachedTokenFor(
  cached: CachedToken,
  serverUrl: string,
  email: string | undefined
): string | null {
  if (cached.serverUrl !== serverUrl) {
    return null;
  }
  if (!email || cached.email !== email) {
    return null;
  }
  return cached.token;
}
