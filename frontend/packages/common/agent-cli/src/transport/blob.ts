import { CliError } from '../errors';
import type { Auth } from './auth';

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const DEFAULT_MIME = 'application/octet-stream';

/**
 * Blob の送受信の時間切れ。本文の受信・送信の終わりまで効くため、GraphQL（30 秒）より長くする。
 * 例: 50 MB を 2 Mbps で受けると約 3.5 分
 */
const BLOB_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Blob（画像・添付）の取得。ブラウザと同じ `GET /api/workspaces/:ws/blobs/:key`。
 *
 * ⚠️ 送り先は設定のサーバーだけ（トークンを他所へ送らない）。
 * 401 なら1回だけサインインし直して再送する（GraphqlClient と同じ）。
 */
export class BlobClient {
  constructor(
    private readonly serverUrl: string,
    private readonly auth: Auth,
    private readonly maxBytes: number
  ) {}

  async get(
    workspaceId: string,
    key: string
  ): Promise<{ data: Uint8Array; mime: string }> {
    let res = await this.send(workspaceId, key, await this.auth.getToken());
    if (res.status === HTTP_UNAUTHORIZED) {
      res = await this.send(workspaceId, key, await this.auth.refresh());
    }
    if (res.status === HTTP_FORBIDDEN || res.status === HTTP_NOT_FOUND) {
      throw new CliError(`ファイルが存在しないか権限が無い: ${key}`);
    }
    if (!res.ok) {
      throw new CliError(`ファイルを取れない（HTTP ${res.status}）: ${key}`);
    }

    // ⚠️ 大きさを先に見る。全部読んでから断ると、通信もメモリも無駄になる
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > this.maxBytes) {
      throw new CliError(
        `大きすぎる: ${key}（${length} バイト。上限 ${this.maxBytes}）`,
        '利用者にブラウザで開いてもらう'
      );
    }
    const data = await this.readLimited(res, key);
    return { data, mime: res.headers.get('content-type') ?? DEFAULT_MIME };
  }

  /**
   * 本文を読みながら数え、上限を超えたら打ち切る。
   * ⚠️ content-length が無い応答（チャンク転送）もあるため、上の判定だけでは守れない
   */
  private async readLimited(res: Response, key: string): Promise<Uint8Array> {
    const reader = res.body?.getReader();
    if (!reader) {
      return new Uint8Array(0);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read().catch(() => {
        // ⚠️ 時間切れ（AbortSignal.timeout は本文の読み切りまで効く）や切断は
        // CliError でない例外で来る。案内の無いエラーで落とさない
        throw new CliError(
          `ファイルの受信が途中で切れた（時間切れか切断）: ${key}`,
          'しばらく待って再実行する'
        );
      });
      if (done) {
        break;
      }
      total += value.length;
      if (total > this.maxBytes) {
        await reader.cancel();
        throw new CliError(
          `大きすぎる: ${key}（${this.maxBytes} バイトを超えた）`,
          '利用者にブラウザで開いてもらう'
        );
      }
      chunks.push(value);
    }
    const data = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    return data;
  }

  /**
   * Blob を送る（#278）。ブラウザと同じく鍵は中身のハッシュ。サーバーは同じ鍵なら何もしない。
   * 書き込み権限（member 以上）が要る（#285）
   */
  async put(
    workspaceId: string,
    key: string,
    data: Uint8Array,
    mime: string
  ): Promise<void> {
    const upload = (token: string) =>
      fetch(this.url(workspaceId, key), {
        method: 'PUT',
        redirect: 'error',
        signal: AbortSignal.timeout(BLOB_TIMEOUT_MS),
        headers: { authorization: `Bearer ${token}`, 'content-type': mime },
        body: data,
      }).catch(() => {
        throw new CliError(`サーバーに接続できない: ${this.serverUrl}`);
      });

    let res = await upload(await this.auth.getToken());
    if (res.status === HTTP_UNAUTHORIZED) {
      res = await upload(await this.auth.refresh());
    }
    if (res.status === HTTP_FORBIDDEN || res.status === HTTP_NOT_FOUND) {
      throw new CliError(
        '画像を送る権限が無い（ワークスペースの Member 以上が要る）',
        'ワークスペースの管理者に権限を付けてもらう'
      );
    }
    if (!res.ok) {
      throw new CliError(`画像を送れない（HTTP ${res.status}）`);
    }
  }

  private url(workspaceId: string, key: string): string {
    return `${this.serverUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/blobs/${encodeURIComponent(key)}`;
  }

  private send(workspaceId: string, key: string, token: string) {
    return fetch(this.url(workspaceId, key), {
      // 送り先は設定のサーバーだけ。リダイレクトで他所へ行かない
      redirect: 'error',
      signal: AbortSignal.timeout(BLOB_TIMEOUT_MS),
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => {
      throw new CliError(`サーバーに接続できない: ${this.serverUrl}`);
    });
  }
}
