import { promises as dnsPromises, lookup as dnsLookup } from 'dns';
import { isIP } from 'net';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

/**
 * SSRF 対策ユーティリティ。
 *
 * link-preview / image-proxy はユーザーが貼り付けた任意 URL をサーバー側で
 * 取得する。攻撃者が内部リソース（メタデータサーバ・内部API・localhost 等）へ
 * サーバーを踏み台にアクセスするのを防ぐため、以下を強制する:
 *   - スキームは http/https のみ
 *   - **接続時の DNS 解決結果**を検証し、全 IP がグローバルでなければ接続しない。
 *     検証と接続で別々に解決すると DNS リバインディング（TOCTOU）で内部 IP に
 *     差し替えられるため、`http(s).request` の `lookup` フックで解決した IP を
 *     その場で検証し、そのままソケット接続に使う（＝検証した IP に接続をピン止め）。
 *   - リダイレクトは手動追跡し、各ホップで再検証
 *   - タイムアウト・最大サイズ上限
 */

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 8000;

/** IPv4 がプライベート/予約領域か。 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(n => parseInt(n, 10));
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // パースできない=安全側で拒否
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // ループバック
  if (a === 169 && b === 254) return true; // リンクローカル(169.254/16, クラウドメタデータ含む)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // マルチキャスト/予約 224+
  return false;
}

/**
 * IPv6 がプライベート/予約領域か（IPv4射影は IPv4 判定に委譲）。
 * 先頭ブロックの前方一致（例: startsWith('fe80')）は fe80::/10 を正しく
 * カバーできない（fe81:: 等がすり抜ける）ため、先頭16bitを16進数として
 * パースしビット範囲で判定する。
 */
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // ループバック/未指定
  const mapped = lower.match(/^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);

  const firstBlockStr = lower.split(':')[0];
  const firstBlock = parseInt(firstBlockStr, 16);
  if (Number.isNaN(firstBlock)) return true; // パース不可=安全側で拒否
  if (firstBlock >= 0xfc00 && firstBlock <= 0xfdff) return true; // ユニークローカル fc00::/7
  if (firstBlock >= 0xfe80 && firstBlock <= 0xfebf) return true; // リンクローカル fe80::/10
  if (firstBlock >= 0xfec0 && firstBlock <= 0xfeff) return true; // サイトローカル(非推奨) fec0::/10
  if (firstBlock >= 0xff00 && firstBlock <= 0xffff) return true; // マルチキャスト ff00::/8
  return false;
}

export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true; // 不明=拒否
}

/**
 * URL のスキーム検証と、ホストが IP リテラルの場合の早期検証。
 * ホスト名（要 DNS）の検証は接続時 lookup フックで行う（TOCTOU 回避）。
 */
export function assertSafeUrlScheme(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed');
  }
  const host = url.hostname;
  if (isIP(host) && isPrivateIp(host)) {
    throw new Error('Blocked private/reserved address');
  }
  return url;
}

/** 事前検証（任意）。呼び出し側の早期拒否用に DNS 解決して全 IP を検証する。 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  const url = assertSafeUrlScheme(rawUrl);
  const host = url.hostname;
  if (isIP(host)) return url; // リテラルは assertSafeUrlScheme で検証済み
  let addresses: { address: string }[];
  try {
    addresses = await dnsPromises.lookup(host, { all: true });
  } catch {
    throw new Error('DNS resolution failed');
  }
  if (addresses.length === 0) throw new Error('DNS resolution empty');
  for (const { address } of addresses) {
    if (isPrivateIp(address)) throw new Error('Blocked private/reserved address');
  }
  return url;
}

/**
 * DNS リバインディング対策の lookup フック。
 * 解決した全アドレスを検証し、いずれかが内部/予約なら接続を失敗させる。
 * 検証に通ったアドレスをそのままソケットに渡すため、検証した IP に接続がピン止めされる。
 */
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

function safeLookup(
  hostname: string,
  options: { all?: boolean } & Record<string, unknown>,
  callback: LookupCallback,
): void {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const list = Array.isArray(addresses) ? addresses : [addresses as any];
    if (list.length === 0) {
      return callback(new Error('DNS resolution empty'), '');
    }
    for (const a of list) {
      if (!a || isPrivateIp(a.address)) {
        return callback(
          Object.assign(new Error('Blocked private/reserved address'), {
            code: 'ESSRFBLOCKED',
          }),
          '',
        );
      }
    }
    if (options?.all) {
      callback(null, list.map(a => ({ address: a.address, family: a.family })));
    } else {
      callback(null, list[0].address, list[0].family);
    }
  });
}

export interface SafeFetchResult {
  status: number;
  contentType: string | null;
  body: Buffer;
  finalUrl: string;
}

/**
 * SSRF 安全な GET。接続時 lookup で解決 IP を検証・ピン止めし、リダイレクトを
 * 手動追跡（各ホップで再検証）、タイムアウトと最大サイズを強制する。
 */
export async function safeFetch(
  rawUrl: string,
  opts: { maxBytes: number; timeoutMs?: number; accept?: string },
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = assertSafeUrlScheme(currentUrl);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;

    const result = await new Promise<
      | { redirect: string }
      | SafeFetchResult
    >((resolve, reject) => {
      const req = mod.request(
        url,
        {
          method: 'GET',
          // 検証済み IP に接続をピン止め（DNS リバインディング対策）。
          lookup: safeLookup as any,
          headers: {
            'user-agent': 'ofuro-wiki-link-preview/1.0',
            accept: opts.accept ?? '*/*',
          },
          timeout: timeoutMs,
        },
        res => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            const location = res.headers.location;
            res.destroy();
            if (!location) return reject(new Error('Redirect without location'));
            return resolve({
              redirect: new URL(location, url.toString()).toString(),
            });
          }
          const declared = Number(res.headers['content-length'] || '0');
          if (declared && declared > opts.maxBytes) {
            res.destroy();
            return reject(new Error('Response too large'));
          }
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > opts.maxBytes) {
              res.destroy();
              reject(new Error('Response too large'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            resolve({
              status,
              contentType: (res.headers['content-type'] as string) ?? null,
              body: Buffer.concat(chunks),
              finalUrl: url.toString(),
            }),
          );
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('Request timeout')));
      req.on('error', reject);
      req.end();
    });

    if ('redirect' in result) {
      currentUrl = result.redirect;
      continue;
    }
    return result;
  }
  throw new Error('Too many redirects');
}
