import {
  checkRootEmailEnv,
  getAdminEmail,
  isAdminEmail,
} from '../../src/common/admin-email';

/** #77: ADMIN_EMAIL のユーザーがサインアップしても Admin にならない問題の回帰テスト */
describe('admin-email (#77)', () => {
  const original = process.env.ADMIN_EMAIL;

  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = original;
  });

  it('未設定なら誰も Admin にならない', () => {
    delete process.env.ADMIN_EMAIL;
    expect(getAdminEmail()).toBeUndefined();
    expect(isAdminEmail('anyone@example.com')).toBe(false);
  });

  it('空白のみの設定は未設定として扱う', () => {
    process.env.ADMIN_EMAIL = '   ';
    expect(getAdminEmail()).toBeUndefined();
    expect(isAdminEmail('')).toBe(false);
  });

  it('一致すれば true', () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';
    expect(isAdminEmail('admin@example.com')).toBe(true);
  });

  it('設定値（.env）の前後の空白は無視する', () => {
    process.env.ADMIN_EMAIL = ' admin@example.com ';
    expect(isAdminEmail('admin@example.com')).toBe(true);
  });

  it('【重要】前後に空白の付いたアドレスは Admin にしない（権限昇格の防止）', () => {
    // 入力側を trim すると、"admin@example.com "（末尾に空白）で登録された
    // 別アカウントが一致してしまい、大文字小文字と同じ経路で昇格を許す。
    process.env.ADMIN_EMAIL = 'admin@example.com';
    expect(isAdminEmail('admin@example.com ')).toBe(false);
    expect(isAdminEmail(' admin@example.com')).toBe(false);
    expect(isAdminEmail('admin@example.com\t')).toBe(false);
  });

  it('【重要】大文字小文字違いは Admin にしない（権限昇格の防止）', () => {
    // users.email は大文字小文字を区別する一意制約のため、
    // ADMIN@example.com は admin@example.com とは別アカウントとして登録できる。
    // ここで大文字小文字を無視すると、第三者が大文字違いでサインアップするだけで
    // 管理者になれてしまう（重複チェックは完全一致で素通りする）。
    process.env.ADMIN_EMAIL = 'admin@example.com';
    expect(isAdminEmail('ADMIN@example.com')).toBe(false);
    expect(isAdminEmail('Admin@Example.com')).toBe(false);
    expect(isAdminEmail('admin@EXAMPLE.com')).toBe(false);
  });

  it('別のアドレスは false', () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';
    expect(isAdminEmail('other@example.com')).toBe(false);
    // 部分一致で誤判定しないこと
    expect(isAdminEmail('admin@example.com.evil.test')).toBe(false);
    expect(isAdminEmail('xadmin@example.com')).toBe(false);
  });
});

/** #297: ADMIN_EMAIL → ROOT_EMAIL の改名（docs/workspace-model.md 12.1.1） */
describe('ROOT_EMAIL と古い名前 ADMIN_EMAIL', () => {
  const original = {
    root: process.env.ROOT_EMAIL,
    legacy: process.env.ADMIN_EMAIL,
  };

  /** 未定義は消す（undefined を代入すると文字列 "undefined" になる） */
  function setEnv(name: string, value: string | undefined) {
    if (value === undefined) {
      delete process.env[name];
      return;
    }
    process.env[name] = value;
  }

  afterEach(() => {
    setEnv('ROOT_EMAIL', original.root);
    setEnv('ADMIN_EMAIL', original.legacy);
  });

  it('ROOT_EMAIL だけなら、それを使う。警告なし', () => {
    setEnv('ROOT_EMAIL', 'root@example.com');
    setEnv('ADMIN_EMAIL', undefined);

    expect(getAdminEmail()).toBe('root@example.com');
    expect(isAdminEmail('root@example.com')).toBe(true);
    expect(checkRootEmailEnv()).toBeUndefined();
  });

  it('【重要】ADMIN_EMAIL だけでも root は居なくならない。改名を促す', () => {
    setEnv('ROOT_EMAIL', undefined);
    setEnv('ADMIN_EMAIL', 'root@example.com');

    expect(getAdminEmail()).toBe('root@example.com');
    expect(checkRootEmailEnv()).toMatch(/ROOT_EMAIL/);
  });

  it('同じ値なら ROOT_EMAIL を使い、ADMIN_EMAIL を消すよう促す', () => {
    setEnv('ROOT_EMAIL', 'root@example.com');
    setEnv('ADMIN_EMAIL', ' root@example.com ');

    expect(getAdminEmail()).toBe('root@example.com');
    expect(checkRootEmailEnv()).toMatch(/ADMIN_EMAIL/);
  });

  it('【重要】違う値なら起動させない（どちらが root か決められない）', () => {
    setEnv('ROOT_EMAIL', 'root@example.com');
    setEnv('ADMIN_EMAIL', 'other@example.com');

    expect(() => checkRootEmailEnv()).toThrow(/ROOT_EMAIL/);
  });

  it('空白だけの ROOT_EMAIL は無いものとして ADMIN_EMAIL を使う', () => {
    setEnv('ROOT_EMAIL', '  ');
    setEnv('ADMIN_EMAIL', 'root@example.com');

    expect(getAdminEmail()).toBe('root@example.com');
    expect(() => checkRootEmailEnv()).not.toThrow();
  });

  it('両方なければ root なし。警告なし', () => {
    setEnv('ROOT_EMAIL', undefined);
    setEnv('ADMIN_EMAIL', undefined);

    expect(getAdminEmail()).toBeUndefined();
    expect(checkRootEmailEnv()).toBeUndefined();
  });
});
