import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthModule } from '../../../src/modules/auth/auth.module';
import { COOKIE_OPTIONS } from '../../../src/modules/auth/auth-cookie.util';
import { SESSION_TTL_DAYS } from '../../../src/modules/auth/session-ttl';

/** #332: サインインの期限は 30 日。トークンとクッキーを揃える（docs/signin-registration.md 7 章） */
describe('サインインの期限 (#332)', () => {
  const DAY_SECONDS = 24 * 60 * 60;

  it('30 日', () => {
    expect(SESSION_TTL_DAYS).toBe(30);
  });

  it('クッキーは 30 日残る', () => {
    expect(COOKIE_OPTIONS.maxAge).toBe(30 * DAY_SECONDS * 1000);
  });

  it('【重要】トークンも 30 日で切れる（クッキーと揃える）', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] })
      .useMocker(() => ({}))
      .compile();
    const jwt = moduleRef.get(JwtService);

    const token = jwt.sign({ sub: 'user-1' });
    const { iat, exp } = jwt.decode(token) as { iat: number; exp: number };

    expect(exp - iat).toBe(30 * DAY_SECONDS);
    expect(exp - iat).toBe(COOKIE_OPTIONS.maxAge / 1000);
  });
});
