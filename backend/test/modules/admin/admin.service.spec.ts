import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AdminService } from '../../../src/modules/admin/admin.service';
import { DOC_VIEW_SETTING_KEY } from '../../../src/modules/audit/doc-view-recorder';

describe('AdminService', () => {
  let service: AdminService;
  let mockPrisma: any;
  let audit: any;
  let indexReader: any;
  let docViews: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: `id-${data.email}`,
          ...data,
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      serverSetting: { upsert: jest.fn().mockResolvedValue({}) },
    };
    audit = { record: jest.fn() };
    docViews = { forgetSetting: jest.fn() };
    indexReader = { readWorkspaceName: jest.fn().mockResolvedValue(null) };
    service = new AdminService(
      mockPrisma,
      audit,
      { bump: jest.fn() } as any,
      indexReader,
      docViews,
    );
  });

  // #100: 閲覧の記録の設定は、変えたらすぐ効かせる（覚えた値を捨てる）
  describe('updateSetting', () => {
    it('閲覧の記録の設定を変えると、覚えた値を捨てる', async () => {
      await service.updateSetting(DOC_VIEW_SETTING_KEY, 'true');

      expect(docViews.forgetSetting).toHaveBeenCalledTimes(1);
    });

    it('ほかの設定では捨てない', async () => {
      await service.updateSetting('registration_open', 'false');

      expect(docViews.forgetSetting).not.toHaveBeenCalled();
    });
  });

  // #92: CSV 一括登録
  /**
   * 汎用の書き換え（adminUpdateServerSetting）で触れるのは、管理画面が使う設定だけ。
   * 何でも書けると、専用の処理（SSO の発行者を変えたらシークレットを消す等）を
   * 素通りできる（#330 のレビュー）。SSO は updateOidcConfig だけで変える
   */
  describe('汎用の設定の書き換えで触れる設定を絞る', () => {
    it.each([
      'registration_open',
      'link_preview_enabled',
      'backup_enabled',
      'backup_retention_days',
      'backup_schedule',
      'audit_log_doc_view_enabled',
    ])('%s は書ける', async (key) => {
      await expect(service.updateSetting(key, 'x')).resolves.toBeDefined();
      expect(mockPrisma.serverSetting.upsert).toHaveBeenCalled();
    });

    it.each(['oidc_issuer', 'oidc_client_secret', 'oidc_enabled', 'manual_seed_version', 'anything'])(
      '【重要】%s は書けない',
      async (key) => {
        await expect(service.updateSetting(key, 'https://evil.example')).rejects.toThrow(
          BadRequestException,
        );
        expect(mockPrisma.serverSetting.upsert).not.toHaveBeenCalled();
      },
    );

    it('【重要】一覧で返すのも、管理画面が使う設定だけ（暗号化したシークレットを返さない）', async () => {
      mockPrisma.serverSetting.findMany = jest.fn().mockResolvedValue([]);

      await service.getSettings();

      const where = mockPrisma.serverSetting.findMany.mock.calls[0][0].where;
      expect(where.key.in).toContain('registration_open');
      expect(where.key.in).not.toContain('oidc_client_secret');
    });
  });

  describe('validateUserCsv', () => {
    const row = (line: number, email: string, password = 'Pass1234!') => ({
      line,
      email,
      name: '',
      password,
    });

    it('問題のない行は ok', async () => {
      const [result] = await service.validateUserCsv([row(2, 'a@example.com')]);
      expect(result).toMatchObject({ line: 2, email: 'a@example.com', ok: true });
    });

    it('検証だけでは登録しない', async () => {
      await service.validateUserCsv([row(2, 'a@example.com')]);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it.each([
      ['メールアドレスが空', row(2, ''), 'メールアドレスが空です'],
      ['形式不正', row(2, 'not-an-email'), 'メールアドレスの形式が正しくありません'],
      ['パスワードが空', row(2, 'a@example.com', ''), 'パスワードが空です'],
    ])('%s は NG', async (_label, target, message) => {
      const [result] = await service.validateUserCsv([target]);
      expect(result.ok).toBe(false);
      expect(result.error).toBe(message);
    });

    it('パスワードの前後に空白があると NG', async () => {
      const [result] = await service.validateUserCsv([
        row(2, 'a@example.com', ' Pass1234! '),
      ]);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('パスワードの前後に空白が含まれています');
    });

    it('短すぎるパスワードは NG（他経路と同じ検証）', async () => {
      const [result] = await service.validateUserCsv([
        row(2, 'a@example.com', 'short'),
      ]);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('パスワード');
    });

    // 1件目まで巻き添えで NG にすると、直しようがなくなる
    it('CSV 内で重複したら2件目以降だけ NG', async () => {
      const results = await service.validateUserCsv([
        row(2, 'a@example.com'),
        row(3, 'A@Example.com'),
      ]);
      expect(results[0].ok).toBe(true);
      expect(results[1].ok).toBe(false);
      expect(results[1].error).toBe('この CSV 内で重複しています');
    });

    it('既存ユーザーと重複したら NG', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { email: 'a@example.com' },
      ]);
      const [result] = await service.validateUserCsv([row(2, 'A@EXAMPLE.com')]);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('すでに登録されているメールアドレスです');
    });
  });

  describe('importUsersFromCsv', () => {
    const row = (line: number, email: string, password = 'Pass1234!') => ({
      line,
      email,
      name: '',
      password,
    });

    // 失敗行があっても他の行は登録する（全件ロールバックしない）
    it('NG 行があっても OK 行は登録する', async () => {
      const results = await service.importUsersFromCsv(
        [row(2, 'a@example.com'), row(3, 'bad-email'), row(4, 'c@example.com')],
        'admin@example.com',
      );
      expect(results.map((r) => r.ok)).toEqual([true, false, true]);
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(2);
    });

    it('NG 行は作成を試みない', async () => {
      await service.importUsersFromCsv(
        [row(2, 'a@example.com', 'short')],
        'admin@example.com',
      );
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    // 検証と登録の間に別の Admin が登録した場合を想定
    it('作成時の例外は、その行だけ失敗にする', async () => {
      mockPrisma.user.create
        .mockRejectedValueOnce(new Error('Email already registered'))
        .mockImplementationOnce(({ data }: any) => ({ id: 'x', ...data }));
      const results = await service.importUsersFromCsv(
        [row(2, 'a@example.com'), row(3, 'b@example.com')],
        'admin@example.com',
      );
      expect(results[0]).toMatchObject({
        ok: false,
        error: 'Email already registered',
      });
      expect(results[1].ok).toBe(true);
    });
  });

  // #115: パスワードを忘れた利用者を復旧させる主経路。
  describe('setUserPassword', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'target@example.com',
      });
    });

    it('パスワードをハッシュ化して保存する', async () => {
      await service.setUserPassword('user-1', 'NewPass123!', { id: 'admin', email: 'admin@example.com' });

      const { data, where } = mockPrisma.user.update.mock.calls[0][0];
      expect(where).toEqual({ id: 'user-1' });
      // 平文のまま保存していないこと
      expect(data.passwordHash).not.toBe('NewPass123!');
      await expect(
        bcrypt.compare('NewPass123!', data.passwordHash),
      ).resolves.toBe(true);
    });

    // 乗っ取られたアカウントの復旧を想定。攻撃者のセッションを残さない。
    it('対象ユーザーの全セッションを失効させる', async () => {
      await service.setUserPassword('user-1', 'NewPass123!', { id: 'admin', email: 'admin@example.com' });

      const { data } = mockPrisma.user.update.mock.calls[0][0];
      expect(data.tokenVersion).toEqual({ increment: 1 });
    });

    it('存在しないユーザーは NotFound', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.setUserPassword('missing', 'NewPass123!', { id: 'admin', email: 'admin@example.com' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it.each([
      ['短すぎる', 'Short1!'],
      ['長すぎる', 'a'.repeat(129)],
    ])('%s パスワードは拒否する', async (_label, password) => {
      await expect(
        service.setUserPassword('user-1', password, { id: 'admin', email: 'admin@example.com' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  // #297: root（ADMIN_EMAIL）を守る（docs/workspace-model.md 3.5・12.5）
  describe('root の保護', () => {
    const ROOT = 'root@example.com';
    const savedEnv = process.env.ADMIN_EMAIL;

    beforeEach(() => {
      process.env.ADMIN_EMAIL = ROOT;
      mockPrisma.user.delete = jest.fn();
      mockPrisma.workspace = {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
      };
    });
    afterEach(() => {
      process.env.ADMIN_EMAIL = savedEnv;
    });

    it('⚠️ root は消せない（何も消さない）', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'r', email: ROOT });

      await expect(service.deleteUser('r', { email: 'a@x' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.workspace.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('⚠️ root は管理者を外せない', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'r', email: ROOT });

      await expect(service.setAdmin('r', false)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    // ⚠️ ほかのシステム管理者が root のパスワードを変えられると、root を乗っ取れる
    it('⚠️ ほかのシステム管理者は、root のパスワードを再設定できない', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'r', email: ROOT });

      await expect(service.setUserPassword('r', 'NewPass1234!', { id: 'other', email: 'other@example.com' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    // 本人かどうかは ID で比べる。セッションのメールアドレスの表記が違っても本人は弾かれない
    it('root 本人は、自分のパスワードを再設定できる（メールアドレスの表記が違っても）', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'r', email: ROOT });

      await service.setUserPassword('r', 'NewPass1234!', { id: 'r', email: 'ROOT@EXAMPLE.COM' });
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('⚠️ ほかのシステム管理者は、root の全端末をサインアウトさせられない', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'r', email: ROOT });

      await expect(service.revokeUserSessions('r', 'other')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('root 以外のユーザーは、システム管理者が全端末をサインアウトさせられる（退行防止）', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u', email: 'u@example.com' });

      await service.revokeUserSessions('u', 'other');
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('root 以外は管理者を外せる', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u', email: 'u@example.com' });

      await service.setAdmin('u', false);
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('⚠️ 共有の持ち主のユーザーは消さない（移行前。消すと共有が消える #296）', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u', email: 'u@example.com' });
      mockPrisma.workspace.findMany.mockResolvedValue([
        { id: 'w', name: '社内Wiki', kind: 'shared' },
      ]);

      await expect(service.deleteUser('u', { email: 'a@x' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.workspace.deleteMany).not.toHaveBeenCalled();
    });

    it('一般ユーザーを消すと、その人のプライベートだけが消える', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u', email: 'u@example.com' });
      mockPrisma.workspace.findMany.mockResolvedValue([
        { id: 'p', name: '個人', kind: 'private' },
      ]);

      await service.deleteUser('u', { email: 'a@x' });
      expect(mockPrisma.workspace.deleteMany).toHaveBeenCalledWith({ where: { ownerId: 'u' } });
      expect(mockPrisma.user.delete).toHaveBeenCalled();
    });
  });

  // #297: root が替わったら、共有の持ち主を付け替える（12.7）
  describe('reassignSharedOwner', () => {
    let tx: any;

    beforeEach(() => {
      tx = {
        workspace: { update: jest.fn() },
        workspaceMember: { upsert: jest.fn(), updateMany: jest.fn() },
      };
      mockPrisma.workspace = { findMany: jest.fn() };
      mockPrisma.$transaction = jest.fn((fn: any) => fn(tx));
    });

    it('持ち主を root にし、前の持ち主はワークスペース管理者に下げる（外さない）', async () => {
      mockPrisma.workspace.findMany.mockResolvedValue([
        { id: 'w', ownerId: 'old', name: '社内Wiki' },
      ]);

      await service.reassignSharedOwner('root');

      expect(mockPrisma.workspace.findMany).toHaveBeenCalledWith({
        where: { kind: 'shared', ownerId: { not: 'root' } },
        select: { id: true, ownerId: true, name: true },
      });
      expect(tx.workspace.update).toHaveBeenCalledWith({
        where: { id: 'w' },
        data: { ownerId: 'root' },
      });
      expect(tx.workspaceMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ userId: 'root', role: 'owner' }),
          update: { role: 'owner', status: 'accepted' },
        }),
      );
      expect(tx.workspaceMember.updateMany).toHaveBeenCalledWith({
        where: { workspaceId: 'w', userId: 'old' },
        data: { role: 'admin' },
      });
    });

    it('付け替えを監査ログに残す（ADMIN_EMAIL の打ち間違いに後から気付けるように）', async () => {
      mockPrisma.workspace.findMany.mockResolvedValue([
        { id: 'w', ownerId: 'old', name: '社内Wiki' },
      ]);

      await service.reassignSharedOwner('root');

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'workspace.owner.reassign',
          actor: { email: 'system' },
          targetId: 'w',
          targetName: '社内Wiki',
          detail: { meta: { from: 'old', to: 'root' } },
        }),
      );
    });

    it('1 件で失敗しても起動を止めず、残りを付け替える', async () => {
      mockPrisma.workspace.findMany.mockResolvedValue([
        { id: 'w1', ownerId: 'old', name: 'A' },
        { id: 'w2', ownerId: 'old', name: 'B' },
      ]);
      tx.workspace.update
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({});

      await expect(service.reassignSharedOwner('root')).resolves.toBeUndefined();
      expect(tx.workspace.update).toHaveBeenCalledTimes(2);
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'w2' }));
    });

        it('付け替えるものが無ければ何もしない', async () => {
      mockPrisma.workspace.findMany.mockResolvedValue([]);

      await service.reassignSharedOwner('root');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // #297: 管理画面「ワークスペース」（docs/workspace-model.md 12.8.1）
  describe('listSharedWorkspaces', () => {
    const created = new Date('2026-10-01T00:00:00Z');
    const at = (iso: string) => ({ timestamp: new Date(iso) });

    beforeEach(() => {
      mockPrisma.workspace = { findMany: jest.fn() };
      mockPrisma.docSnapshot = { groupBy: jest.fn().mockResolvedValue([]) };
      mockPrisma.docUpdate = { groupBy: jest.fn().mockResolvedValue([]) };
    });

    it('共有だけを、参加済みの人数つきで取る', async () => {
      mockPrisma.workspace.findMany.mockResolvedValue([
        { id: 'wiki', createdAt: created, _count: { members: 4 } },
      ]);

      const list = await service.listSharedWorkspaces();

      const query = mockPrisma.workspace.findMany.mock.calls[0][0];
      expect(query.where).toEqual({ kind: 'shared' });
      expect(query.select._count.select.members.where).toEqual({ status: 'accepted' });
      expect(list).toEqual([{ id: 'wiki', memberCount: 4, updatedAt: created }]);
    });

    it('最終更新はページの保存時刻の新しいほう。ページが無ければ作った時刻。新しい順に並べる', async () => {
      mockPrisma.workspace.findMany.mockResolvedValue([
        { id: 'empty', createdAt: created, _count: { members: 1 } },
        { id: 'busy', createdAt: created, _count: { members: 2 } },
      ]);
      mockPrisma.docSnapshot.groupBy.mockResolvedValue([
        { workspaceId: 'busy', _max: at('2026-10-10T00:00:00Z') },
      ]);
      mockPrisma.docUpdate.groupBy.mockResolvedValue([
        { workspaceId: 'busy', _max: at('2026-10-20T00:00:00Z') },
      ]);

      const list = await service.listSharedWorkspaces();

      expect(list.map((w) => w.id)).toEqual(['busy', 'empty']);
      expect(list[0].updatedAt).toEqual(new Date('2026-10-20T00:00:00Z'));
      expect(list[1].updatedAt).toEqual(created);
    });
  });

  // #297: ユーザー管理（docs/workspace-model.md 12.8.3）
  describe('ユーザー管理の root と削除の確認', () => {
    const ROOT = 'root@example.com';
    const saved = { root: process.env.ROOT_EMAIL, legacy: process.env.ADMIN_EMAIL };

    beforeEach(() => {
      process.env.ROOT_EMAIL = ROOT;
      delete process.env.ADMIN_EMAIL;
      mockPrisma.user.count = jest.fn().mockResolvedValue(2);
      mockPrisma.workspace = { findFirst: jest.fn() };
    });
    afterEach(() => {
      for (const [name, value] of [
        ['ROOT_EMAIL', saved.root],
        ['ADMIN_EMAIL', saved.legacy],
      ] as const) {
        if (value === undefined) {
          delete process.env[name];
          continue;
        }
        process.env[name] = value;
      }
    });

    it('一覧で root に印を付ける（root はほかのシステム管理者と区別して出す）', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'r', email: ROOT, isAdmin: true },
        { id: 'a', email: 'admin@example.com', isAdmin: true },
      ]);

      const { items } = await service.listUsers();

      expect(items.map((u: any) => [u.id, u.isRoot])).toEqual([
        ['r', true],
        ['a', false],
      ]);
    });

    it('プライベートの名前はワークスペースの中（Yjs）から取る', async () => {
      mockPrisma.workspace.findFirst.mockResolvedValue({ id: 'p1', name: 'Workspace' });
      indexReader.readWorkspaceName.mockResolvedValue('山田の下書き');

      expect(await service.privateWorkspaceName('u1')).toBe('山田の下書き');
      expect(mockPrisma.workspace.findFirst.mock.calls[0][0].where).toEqual({
        ownerId: 'u1',
        kind: 'private',
      });
      expect(indexReader.readWorkspaceName).toHaveBeenCalledWith('p1');
    });

    it('中に名前が無ければサーバーの名前。プライベートが無ければ null', async () => {
      mockPrisma.workspace.findFirst.mockResolvedValueOnce({ id: 'p1', name: 'e2e-private' });
      expect(await service.privateWorkspaceName('u1')).toBe('e2e-private');

      mockPrisma.workspace.findFirst.mockResolvedValueOnce(null);
      expect(await service.privateWorkspaceName('u2')).toBeNull();
    });
  });
});
