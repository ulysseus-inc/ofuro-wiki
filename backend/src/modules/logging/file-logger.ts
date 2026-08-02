import { ConsoleLogger, LogLevel } from '@nestjs/common';
import * as util from 'util';
import { LogFileService } from './log-file.service';

/**
 * #90: アプリケーションログを、標準出力に加えてファイルへも書く。
 *
 * 標準出力だけだと `docker logs` のローテート（容量基準）でしか制御できず、
 * 「90日保持」を保証できない。詳細は docs/logging.md 5章。
 */
/**
 * ログに出す値を文字列にする。
 *
 * ⚠️ `JSON.stringify` は使わない。
 * - **循環参照で例外を投げる。** printMessages は write() の try/catch の外側
 *   （Nest の Logger 経由で呼ばれる）ため、`logger.log(obj)` した箇所まで例外が
 *   伝わり、**ログを出そうとしただけで処理が失敗する**
 * - **`Error` が `{}` になる。** `JSON.stringify(new Error('x'))` は `'{}'` を返し、
 *   メッセージもスタックも消える
 *
 * `util.inspect` は循環参照を `[Circular]` として扱い、`Error` も内容を保つ。
 */
function format(message: unknown): string {
  if (typeof message === 'string') return message;
  try {
    return util.inspect(message, { depth: 3, breakLength: Infinity });
  } catch {
    // inspect すら失敗する値（getter が投げる等）でも、ログのために止めない
    return String(message);
  }
}

export class FileLogger extends ConsoleLogger {
  private static logFile: LogFileService | null = null;

  /** 起動時に一度だけ結びつける（Nest の DI が済んでから呼ぶ）。 */
  static attach(service: LogFileService): void {
    FileLogger.logFile = service;
  }

  protected printMessages(
    messages: unknown[],
    context?: string,
    logLevel: LogLevel = 'log',
    writeStreamType?: 'stdout' | 'stderr',
    // ⚠️ `logger.error(message, stack)` のスタックトレースはこの引数で渡る。
    // 受け取らずに super を呼ぶと、**標準出力からもファイルからもスタックが消える**。
    // 障害調査で最も必要な情報なので、必ず引き継ぐこと。
    errorStack?: unknown,
  ): void {
    super.printMessages(
      messages,
      context,
      logLevel,
      writeStreamType,
      errorStack,
    );

    if (!FileLogger.logFile) return;
    const timestamp = new Date().toISOString();
    for (const message of messages) {
      FileLogger.logFile.write(
        'app',
        `${timestamp} ${logLevel.toUpperCase()} [${context ?? '-'}] ${format(message)}`,
      );
    }
    if (errorStack) {
      FileLogger.logFile.write('app', String(errorStack));
    }
  }
}

/**
 * #90: 出力するログレベルを決める。
 *
 * 既定は error / warn / log（INFO）まで。`debug` / `verbose` は出さない。
 * `LOG_LEVEL=debug` を指定した場合のみ詳細を出す。
 */
export function resolveLogLevels(): LogLevel[] {
  const level = (process.env.LOG_LEVEL || 'log').toLowerCase();
  // 深刻な順。`fatal` は NestJS の LOG_LEVELS に含まれるため、
  // 落とすと**最も重要なログが消える**。必ず先頭に置く。
  const order: LogLevel[] = [
    'fatal',
    'error',
    'warn',
    'log',
    'debug',
    'verbose',
  ];
  const index = order.indexOf(level as LogLevel);
  const defaultIndex = order.indexOf('log');
  // 未知の値は既定（log まで）として扱う。起動を失敗させない。
  return order.slice(0, (index === -1 ? defaultIndex : index) + 1);
}
