import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

/**
 * #90: ログを日付ごとのファイルへ書き、保持期間を過ぎたものを消す。
 *
 * **標準出力だけにしない理由**（docs/logging.md 5章）:
 * Docker の json-file ローテートは容量でしか制御できず、
 * 「90日保持しています」と言えない。期間で消す仕掛けを別に持つ。
 *
 * 標準出力への出力はやめない（`docker logs` での即時確認のため）。
 * 長期保持をこちらが担う、という役割分担にしている。
 */
export const LOG_DIR =
  process.env.LOG_STORAGE_PATH || path.join(process.cwd(), 'data', 'logs');

const DEFAULT_RETENTION_DAYS = 90;

/**
 * 保持日数。docs/logging.md のとおり既定 90日。
 *
 * ⚠️ 不正な値を素通しすると `NaN` になり、`setDate(NaN)` → `toISOString()` が
 * RangeError を投げて**日次バッチが毎晩失敗し、古いログが消えなくなる**。
 * 設定ミスで静かに壊れるより、既定値で動かす方がよい。
 */
export const LOG_RETENTION_DAYS = (() => {
  const raw = process.env.LOG_RETENTION_DAYS;
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_RETENTION_DAYS;
})();

type LogKind = 'access' | 'app';

@Injectable()
export class LogFileService implements OnModuleDestroy {
  private readonly logger = new Logger(LogFileService.name);
  /** 日付が変わったら開き直すため、種別ごとに1つだけ保持する。 */
  private streams = new Map<LogKind, { date: string; stream: fs.WriteStream }>();

  /**
   * 書き込み失敗を報告している最中かどうか。
   *
   * ⚠️ 失敗を `this.logger.warn()` で報告すると、それが `FileLogger` を通って
   * **この write() を呼び戻す**。`streamFor()` が同期で失敗し続ける状況
   * （mkdir の EACCES / ENOSPC 等）では**無限再帰でプロセスが落ちる**。
   * 報告中は Logger を使わず、標準エラーへ直接書く。
   */
  private reportingFailure = false;

  /** 追記する。書けなくてもアプリは止めない（ログのために停止させない）。 */
  write(kind: LogKind, line: string): void {
    try {
      const stream = this.streamFor(kind);
      stream.write(`${line}\n`);
    } catch (e) {
      // ここで例外を投げると、ログを出そうとしただけでリクエストが失敗する
      this.reportWriteFailure(kind, e as Error);
    }
  }

  /** 書き込み失敗の報告。**再入すると無限再帰になるため、二重には報告しない。** */
  private reportWriteFailure(kind: LogKind, error: Error): void {
    if (this.reportingFailure) return;
    this.reportingFailure = true;
    try {
      // Logger を経由すると再びファイルへ書きに行くため、標準エラーへ直接出す
      process.stderr.write(
        `[LogFileService] ログファイルに書き込めませんでした (${kind}): ${error.message}\n`,
      );
    } finally {
      this.reportingFailure = false;
    }
  }

  private streamFor(kind: LogKind): fs.WriteStream {
    const date = new Date().toISOString().slice(0, 10);
    const current = this.streams.get(kind);
    if (current?.date === date) {
      return current.stream;
    }

    // 日付が変わった or 初回。古いストリームは閉じる
    current?.stream.end();

    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    const stream = fs.createWriteStream(
      path.join(LOG_DIR, `${kind}-${date}.log`),
      { flags: 'a' },
    );
    // ⚠️ createWriteStream の失敗（ENOSPC / EACCES 等）は**非同期の error イベント**で
    // 届く。write() の try/catch では捕まえられず、購読者が居ないと
    // 「ログのためにアプリを止めない」意図に反してプロセスごと落ちる。
    stream.on('error', (e) => {
      // ここも Logger を使わない（同じ理由で書き戻しが起きうる）
      this.reportWriteFailure(kind, e);
      // 壊れたストリームを捨てる。次回の write で開き直す
      if (this.streams.get(kind)?.stream === stream) {
        this.streams.delete(kind);
      }
    });
    this.streams.set(kind, { date, stream });
    return stream;
  }

  /**
   * 当日以外の開きっぱなしのストリームを閉じる。
   *
   * ⚠️ ストリームは**書き込み時にしか開き直さない**。日付が変わっても書き込みが
   * 無ければ、前日のファイルを掴んだままになる。その状態で圧縮・削除すると、
   * 以降の書き込みが**削除済みの inode へ流れて黙って失われる**。
   */
  private closeStaleStreams(): void {
    const today = new Date().toISOString().slice(0, 10);
    for (const [kind, entry] of this.streams) {
      if (entry.date !== today) {
        entry.stream.end();
        this.streams.delete(kind);
      }
    }
  }

  /** ログファイル名（圧縮済みを含む）から日付を取り出す。対象外なら null。 */
  private dateOf(name: string): string | null {
    const matched = /^(access|app)-(\d{4}-\d{2}-\d{2})\.log(\.gz)?$/.exec(name);
    return matched ? matched[2] : null;
  }

  /**
   * 日次のメンテナンス。
   *
   * 1. 前日以前のログを gzip 圧縮する（実測で約 1/10 になる）
   * 2. 保持期間を過ぎたログを削除する
   *
   * 判定はいずれも**ファイル名の日付**で行う。更新時刻だと、追記が続いた
   * ファイルを消し損ねる。
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  maintainLogs(): { compressed: number; deleted: number } {
    const compressed = this.compressOldLogs();
    const deleted = this.cleanupOldLogs();
    return { compressed, deleted };
  }

  /**
   * 当日より前のログを gzip 圧縮する。
   * **当日分は圧縮しない**（書き込み中のため）。
   */
  compressOldLogs(): number {
    if (!fs.existsSync(LOG_DIR)) return 0;

    // 掴んだままのファイルを圧縮・削除すると、以降の書き込みが失われる
    this.closeStaleStreams();

    const today = new Date().toISOString().slice(0, 10);
    let compressed = 0;

    for (const name of fs.readdirSync(LOG_DIR)) {
      if (name.endsWith('.gz')) continue;
      const date = this.dateOf(name);
      if (!date || date >= today) continue;

      const source = path.join(LOG_DIR, name);
      const target = `${source}.gz`;
      try {
        // 小さなファイルを日次で扱うだけなので同期処理で足りる
        fs.writeFileSync(target, zlib.gzipSync(fs.readFileSync(source)));
        fs.unlinkSync(source);
        compressed++;
      } catch (e) {
        // 圧縮できなくても元ファイルは残す（消してから失敗させない）
        if (fs.existsSync(target)) fs.unlinkSync(target);
        this.logger.warn(
          `ログを圧縮できませんでした (${name}): ${(e as Error).message}`,
        );
      }
    }

    if (compressed > 0) {
      this.logger.log(`ログファイルを圧縮しました: ${compressed}件`);
    }
    return compressed;
  }

  /** 保持期間を過ぎたログファイルを削除する（圧縮済みを含む）。 */
  cleanupOldLogs(): number {
    if (!fs.existsSync(LOG_DIR)) return 0;

    this.closeStaleStreams();

    const threshold = new Date();
    threshold.setDate(threshold.getDate() - LOG_RETENTION_DAYS);
    const limit = threshold.toISOString().slice(0, 10);

    let deleted = 0;
    for (const name of fs.readdirSync(LOG_DIR)) {
      const date = this.dateOf(name);
      if (!date || date >= limit) continue;
      try {
        fs.unlinkSync(path.join(LOG_DIR, name));
        deleted++;
      } catch (e) {
        this.logger.warn(
          `古いログを削除できませんでした (${name}): ${(e as Error).message}`,
        );
      }
    }

    if (deleted > 0) {
      this.logger.log(
        `古いログファイルを削除しました: ${deleted}件（保持 ${LOG_RETENTION_DAYS}日）`,
      );
    }
    return deleted;
  }

  onModuleDestroy(): void {
    for (const { stream } of this.streams.values()) {
      stream.end();
    }
    this.streams.clear();
  }
}
