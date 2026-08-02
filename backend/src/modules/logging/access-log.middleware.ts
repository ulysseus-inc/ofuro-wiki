import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { LogFileService } from './log-file.service';

/**
 * #90: アクセスログ。
 *
 * リバースプロキシを前段に置かない構成（アプリが静的ファイルも配信する）のため、
 * アプリ側で記録する。詳細は docs/logging.md 4章。
 */

/**
 * 記録対象のパス。API に絞る。
 *
 * ⚠️ **`/socket.io` は入れない。** engine.io のハンドシェイクは
 * WebSocket アダプタが素の http server 上で処理するため、
 * **Express のミドルウェアを一度も通らない**（実測: E2E で多数の接続を行っても
 * アクセスログに1件も出なかった）。
 * WebSocket の接続・切断は Gateway 側で記録する（#90 後半）。
 */
const LOGGED_PREFIXES = ['/api', '/graphql'];

/** 監視・ヘルスチェックは成功時に記録しない（毎30秒鳴り続けるため）。 */
const ALWAYS_SKIP = ['/api/health'];

/**
 * 値を伏せるクエリパラメータ。
 *
 * ⚠️ #115 のパスワード変更 URL は `?token=...` の形をとる。
 * そのまま記録すると、**アクセスログを読める者がそのトークンで
 * パスワードを変更できてしまう。**
 */
const SECRET_PARAMS = ['token', 'password', 'secret', 'code', 'state'];

/** クエリ文字列の秘匿値を伏せる。パス部分はそのまま返す。 */
export function redactUrl(url: string): string {
  const separator = url.indexOf('?');
  if (separator === -1) return url;

  const path = url.slice(0, separator);
  const query = url.slice(separator + 1);
  const redacted = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      return SECRET_PARAMS.includes(key.toLowerCase())
        ? `${key}=***`
        : pair;
    })
    .join('&');

  return `${path}?${redacted}`;
}

/**
 * 記録対象か判定する。
 *
 * 静的ファイルの成功応答は除外する（アプリがフロントを配信しているため、
 * 全記録では1画面の表示で数百行出る）。
 * ただし**エラー応答は静的ファイルでも記録する**（障害の兆候であるため）。
 */
export function shouldLog(url: string, statusCode: number): boolean {
  const path = url.split('?')[0];
  if (ALWAYS_SKIP.includes(path) && statusCode < 400) return false;
  if (statusCode >= 400) return true;
  return LOGGED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** UserAgent は 255文字で切る（Chrome は 300〜600文字ある）。 */
export const USER_AGENT_MAX = 255;

@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  constructor(private readonly logFile: LogFileService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = Date.now();
    let logged = false;

    // ⚠️ `finish` だけを購読すると、**中断された要求が1件も残らない**。
    // 通信断や利用者による中止では `finish` が起きず `close` だけが起きる。
    // 走査（スキャン）や巨大アップロードの中止は、まさに記録したい事象。
    // `close` は正常終了後にも起きるため、二重に書かないようにする。
    const record = () => {
      if (logged) return;
      logged = true;

      const url = req.originalUrl || req.url;
      // 応答を返しきれなかった要求は、状態が確定していない
      const aborted = !res.writableFinished;
      if (!shouldLog(url, res.statusCode) && !aborted) return;
      if (aborted && !LOGGED_PREFIXES.some((p) => url.split('?')[0].startsWith(p)))
        return;

      const duration = Date.now() - startedAt;
      // 認証済みなら利用者を残す。プロキシのログには無い情報であり、
      // 自前で記録する利点はここにある。
      //
      // ⚠️ **UUID だけでは、ログを読んだ人が誰か分からない。**
      // 後から DB を引く必要があり、しかも**利用者が削除されていれば永久に分からない**
      // （監査ログで actorEmail を値で持つのと同じ理由）。
      // メールアドレスを併記し、ログ単体で追えるようにする。
      const user = (req as any).user as
        | { id?: string; email?: string }
        | undefined;
      const ua = (req.headers['user-agent'] || '').slice(0, USER_AGENT_MAX);

      const line = [
        new Date().toISOString(),
        aborted ? 'ABORTED' : res.statusCode,
        req.method,
        redactUrl(url),
        `${duration}ms`,
        `ip=${req.ip ?? '-'}`,
        `user=${user?.id ?? '-'}`,
        `email=${user?.email ?? '-'}`,
        `ua="${ua}"`,
      ].join(' ');

      this.logFile.write('access', line);
    };

    res.on('finish', record);
    res.on('close', record);

    next();
  }
}
