import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module';
import { MailModule } from '../mail/mail.module';
import { AttackCounterService } from './attack-counter.service';
import { IntrusionDetectionService } from './intrusion-detection.service';

/**
 * #117: 不審なログイン試行の検知と通知（docs/intrusion-detection.md）。
 *
 * `AttackCounterService` は **AuthService とレート制限ガードから呼ばれる**ため
 * Global にしている。ガードは `APP_GUARD` として登録されており、
 * 個別モジュールの provider を注入できない。
 */
@Global()
@Module({
  imports: [PrismaModule, MailModule],
  providers: [AttackCounterService, IntrusionDetectionService],
  exports: [AttackCounterService, IntrusionDetectionService],
})
export class SecurityModule {}
