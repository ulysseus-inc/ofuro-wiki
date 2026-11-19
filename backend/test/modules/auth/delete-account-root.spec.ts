import { ForbiddenException } from '@nestjs/common';
import { AuthService } from '../../../src/modules/auth/auth.service';
import { AttackCounterService } from '../../../src/modules/security/attack-counter.service';
import { PrismaService } from '../../../src/prisma.service';

/**
 * #297: root（ADMIN_EMAIL）は、本人でもアカウントを消せない（docs/permission-matrix.md 1 章）。
 * 共有ワークスペースの持ち主は root なので、消えると持ち主が居なくなる。
 */
describe('本人によるアカウントの削除と root（#297）', () => {
  const ROOT = 'root@example.com';
  const savedEnv = process.env.ADMIN_EMAIL;
  let prisma: any;
  let service: AuthService;

  beforeEach(() => {
    process.env.ADMIN_EMAIL = ROOT;
    prisma = {
      user: {
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(2),
        delete: jest.fn(),
      },
    };
    service = new AuthService(
      prisma as unknown as PrismaService,
      { sign: jest.fn() } as never,
      { record: jest.fn() } as never,
      new AttackCounterService(),
    );
  });
  afterEach(() => {
    process.env.ADMIN_EMAIL = savedEnv;
  });

  it('⚠️ root は、自分のアカウントを消せない', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'r', email: ROOT, isAdmin: true });

    await expect(service.deleteAccount('r')).rejects.toThrow(ForbiddenException);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });
});
