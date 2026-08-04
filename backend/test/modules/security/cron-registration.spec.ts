import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { IntrusionDetectionService } from '../../../src/modules/security/intrusion-detection.service';

/**
 * #117: 検知バッチが定期実行に登録されていることを確認する。
 *
 * ⚠️ **デコレータが外れても、他のどのテストも落ちない。**
 * 検知は静かに動かなくなり、`security.alert` がゼロのまま推移する。
 * その状態は「攻撃が無かった」とまったく同じに見えるため、**誰も気づかない。**
 *
 * 実行間隔は「5分ごと」であることに意味がある（docs/intrusion-detection.md 2章）。
 * 長くすると検知と通知が遅れ、短くすると監査ログへの問い合わせが増える。
 */
describe('検知バッチの定期実行 (#117)', () => {
  const EXPECTED_CRON = '*/5 * * * *';

  const metadata = (): { cronTime?: string } | undefined =>
    Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      IntrusionDetectionService.prototype.scan,
    );

  it('scan が定期実行に登録されている', () => {
    expect(metadata()).toBeDefined();
  });

  it('5分ごとに実行される', () => {
    expect(metadata()?.cronTime).toBe(EXPECTED_CRON);
  });

  it('cron 式が5フィールド形式である', () => {
    // 書き間違えても TypeScript は通ってしまうため、形を検査する
    const fields = String(metadata()?.cronTime).trim().split(/\s+/);
    expect(fields).toHaveLength(5);
    // 分が5分間隔で、残りはすべてワイルドカード（毎時・毎日・毎月・毎曜日）
    expect(fields[0]).toBe('*/5');
    expect(fields.slice(1)).toEqual(['*', '*', '*', '*']);
  });
});
