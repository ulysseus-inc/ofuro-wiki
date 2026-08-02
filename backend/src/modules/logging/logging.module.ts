import { Global, Module } from '@nestjs/common';
import { LogFileService } from './log-file.service';

/**
 * #90: ログ基盤。アクセスログ・アプリケーションログのファイル出力と、
 * 保持期間を過ぎたファイルの削除を担う。
 *
 * どこからでも記録できる必要があるため Global にしている。
 */
@Global()
@Module({
  providers: [LogFileService],
  exports: [LogFileService],
})
export class LoggingModule {}
