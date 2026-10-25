import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CliError } from '../errors';

/** 設定・トークンを置く場所（設計書 §4） */
export const CONFIG_DIR = path.join(os.homedir(), '.ofuro-wiki');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
export const TOKEN_FILE = path.join(CONFIG_DIR, 'token');

/** 本人だけが読み書きできる権限。パスワード・トークンを含むため */
export const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;

const WORKSPACE_PATH = /^\/workspace\/([^/]+)/;
const PAGE_PATH = /^\/workspace\/([^/]+)\/([^/?#]+)/;

/** 設定の出所。エラーにどこを直せばよいかを書くため */
export enum ConfigSource {
  Env = '環境変数',
  File = '設定ファイル',
  Override = '--url',
}

export interface Config {
  /** 例: `https://wiki.example.com` */
  serverUrl: string;
  email?: string;
  password?: string;
  /** 旧形式のワークスペース URL に含まれていた ID。既定の `--workspace` として使う */
  workspace?: string;
  source: ConfigSource;
}

/**
 * 設定ファイルの中身。`workspaceUrl` は旧形式（互換のため読む）。
 *
 * ⚠️ パスワードは持たない（設計書 §4）。古いファイルに `password` があっても読まない
 */
export interface StoredConfig {
  url?: string;
  workspaceUrl?: string;
  email?: string;
}

export type Env = Record<string, string | undefined>;

/**
 * サーバーの URL を読む。ブラウザのアドレスをそのまま貼られてもよいよう、
 * ワークスペース・ページの部分があればワークスペース ID として取り出す。
 *
 * 例: `https://wiki.example.com/workspace/abc/def` → `https://wiki.example.com` / `abc`
 */
export function parseServerUrl(
  raw: string,
  source: ConfigSource
): { serverUrl: string; workspaceId?: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalidUrl(raw, source);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw invalidUrl(raw, source);
  }
  const match = WORKSPACE_PATH.exec(url.pathname);
  return { serverUrl: url.origin, workspaceId: match?.[1] };
}

/**
 * ページの指定を読む。利用者も AI も URL をそのまま貼りがちなため。
 *
 * 例: `abc` → docId のみ / `https://wiki.example.com/workspace/ws1/abc?mode=edgeless` → ws1 と abc
 */
export function parsePageRef(raw: string): {
  workspaceId?: string;
  docId: string;
} {
  if (!/^https?:\/\//.test(raw)) {
    return { docId: raw };
  }

  let pathname: string;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    throw new CliError(`ページの URL が読めない: ${raw}`);
  }
  const match = PAGE_PATH.exec(pathname);
  if (!match) {
    throw new CliError(`ページの URL が読めない: ${raw}`);
  }
  try {
    return { workspaceId: match[1], docId: decodeURIComponent(match[2]) };
  } catch {
    throw new CliError(`ページの URL が読めない: ${raw}`);
  }
}

function invalidUrl(raw: string, source: ConfigSource): CliError {
  return new CliError(
    `${source}の URL が読めない: ${raw}`,
    'ofuro-wiki のサーバーの URL（例 https://wiki.example.com）を指定する'
  );
}

export function loadConfig(urlOverride?: string): Config {
  return selectConfig(process.env, readStoredConfig(), urlOverride);
}

/**
 * 設定を決める。
 *
 * ⚠️ URL・メール・パスワードの 3 つは**同じ場所からまとめて読む**（設計書 §4）。
 * 環境変数に URL があれば環境変数の 3 つ、無ければ設定ファイルの 3 つ。混ぜない。
 *
 * ⚠️ 認証情報は、それと一緒に設定した URL のサーバーにだけ送る。
 * `--url` で別サーバーを指しても、パスワードは渡さない。ページ本文に
 * 仕込まれた指示で AI が別サーバーを指すと、パスワードが漏れるため。
 */
export function selectConfig(
  env: Env,
  stored: StoredConfig,
  urlOverride?: string
): Config {
  const base = baseConfig(env, stored);
  if (!base.url && !urlOverride) {
    throw new CliError(
      'サーバーの URL が未設定',
      'ofuro login を実行するか、環境変数 OFURO_URL / OFURO_EMAIL / OFURO_PASSWORD を設定する'
    );
  }

  const configured = base.url
    ? parseServerUrl(base.url, base.source)
    : undefined;
  const target = urlOverride
    ? parseServerUrl(urlOverride, ConfigSource.Override)
    : (configured as { serverUrl: string; workspaceId?: string });
  const trusted = configured?.serverUrl === target.serverUrl;

  return {
    serverUrl: target.serverUrl,
    email: trusted ? base.email : undefined,
    password: trusted ? base.password : undefined,
    workspace: target.workspaceId,
    source: urlOverride ? ConfigSource.Override : base.source,
  };
}

function baseConfig(
  env: Env,
  stored: StoredConfig
): { url?: string; email?: string; password?: string; source: ConfigSource } {
  const envUrl = env.OFURO_URL ?? env.OFURO_WORKSPACE_URL;
  if (envUrl) {
    return {
      url: envUrl,
      email: env.OFURO_EMAIL,
      password: env.OFURO_PASSWORD,
      source: ConfigSource.Env,
    };
  }
  if (env.OFURO_EMAIL || env.OFURO_PASSWORD) {
    throw new CliError(
      '環境変数は 3 つ揃えて設定する',
      'OFURO_URL / OFURO_EMAIL / OFURO_PASSWORD を全部設定するか、全部外して設定ファイル（ofuro login）を使う'
    );
  }
  return {
    url: stored.url ?? stored.workspaceUrl,
    email: stored.email,
    source: ConfigSource.File,
  };
}

function readStoredConfig(): StoredConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as StoredConfig;
  } catch {
    throw new CliError(
      `設定ファイルが JSON として読めない: ${CONFIG_FILE}`,
      'ファイルを直すか消して ofuro login をやり直す'
    );
  }
}

/** `ofuro login` が対話入力で得た値を保存する */
export function saveConfig(config: { url: string; email: string }): void {
  writePrivateFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * 本人だけが読める権限で書く。
 *
 * ⚠️ 同じ場所に 600 の一時ファイルを作って入れ替える。既存ファイルへ上書きして
 * から権限を絞ると、その間パスワードが緩い権限（例: 644）のまま読める。
 */
export function writePrivateFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), {
    recursive: true,
    mode: PRIVATE_DIR_MODE,
  });
  removeStaleTemps(file);

  const temp = `${file}.${process.pid}${TEMP_SUFFIX}`;
  try {
    fs.writeFileSync(temp, content, { mode: PRIVATE_FILE_MODE, flag: 'wx' });
    fs.renameSync(temp, file);
  } catch (e) {
    fs.rmSync(temp, { force: true });
    throw e;
  }
}

const TEMP_SUFFIX = '.tmp';

/** これより古い一時ファイルだけを「残骸」とみなす。書き込み自体は数ミリ秒で終わる */
const STALE_TEMP_MS = 10 * 60 * 1000;

/**
 * 前回、書き込みの途中で CLI が強制終了したときの一時ファイルを消す。
 * パスワードを含むため、残しておかない。
 *
 * ⚠️ 新しいものは消さない。AI は CLI を並行して動かすことがあり、
 * 別のプロセスが書いている最中の一時ファイルを消すと、その書き込みが失敗する。
 */
function removeStaleTemps(file: string): void {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}.`;
  const threshold = Date.now() - STALE_TEMP_MS;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(prefix) || !name.endsWith(TEMP_SUFFIX)) {
      continue;
    }
    const temp = path.join(dir, name);
    const stat = fs.statSync(temp, { throwIfNoEntry: false });
    if (stat && stat.mtimeMs < threshold) {
      fs.rmSync(temp, { force: true });
    }
  }
}
