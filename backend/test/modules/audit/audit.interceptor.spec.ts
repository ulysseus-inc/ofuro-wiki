import { safeMeta } from '../../../src/modules/audit/audit.interceptor';

describe('監査ログの引数記録 (#90)', () => {
  // 引数をそのまま入れると、パスワードを保存しない設計が意味を失う
  it.each(['password', 'newPassword', 'currentPassword', 'token', 'clientSecret'])(
    '%s は記録しない',
    (key) => {
      expect(safeMeta({ [key]: 'secret-value', userId: 'u1' })).toEqual({
        userId: 'u1',
      });
    },
  );

  it('CSV 本文は記録しない（利用者のパスワードが並んでいる）', () => {
    expect(safeMeta({ csv: 'email,password\na@example.com,Pass1234!' })).toEqual({});
  });

  it('input オブジェクトの中の秘匿値も除く', () => {
    expect(
      safeMeta({ input: { email: 'a@example.com', password: 'Pass1234!' } }),
    ).toEqual({ input: { email: 'a@example.com' } });
  });

  it('通常の値は残す', () => {
    expect(safeMeta({ userId: 'u1', isAdmin: true })).toEqual({
      userId: 'u1',
      isAdmin: true,
    });
  });

  it('null / undefined は落とす', () => {
    expect(safeMeta({ a: null, b: undefined, c: 1 })).toEqual({ c: 1 });
  });
});

describe('作成系の対象記録 (#90)', () => {
  // 引数だけを見ていると「誰を作ったか」が残らない（E2E で検出）
  const { resultIdentity } = require('../../../src/modules/audit/audit.interceptor');

  it('結果から ID とメールアドレスを取る', () => {
    expect(
      resultIdentity({ id: 'u1', email: 'new@example.com', isAdmin: false }),
    ).toEqual({ id: 'u1', name: 'new@example.com' });
  });

  it('ワークスペースは名前を対象名にする', () => {
    expect(resultIdentity({ id: 'ws1', name: '営業部' })).toEqual({
      id: 'ws1',
      name: '営業部',
    });
  });

  it('真偽値や文字列の結果でも落ちない', () => {
    expect(resultIdentity(true)).toEqual({});
    expect(resultIdentity('ok')).toEqual({});
    expect(resultIdentity(null)).toEqual({});
  });
});

describe('ドキュメント操作の記録 (#90)', () => {
  const { resultIdentity } = require('../../../src/modules/audit/audit.interceptor');

  it('結果に id が無い操作でも落ちない', () => {
    expect(resultIdentity({ ok: true })).toEqual({});
  });
});

describe('配列の引数 (#90)', () => {
  const { safeMeta } = require('../../../src/modules/audit/audit.interceptor');

  // 配列を添字キーのオブジェクトにすると、何が並んでいたか読めなくなる
  it('配列は配列のまま残す', () => {
    expect(safeMeta({ ids: ['a', 'b', 'c'] })).toEqual({
      ids: ['a', 'b', 'c'],
    });
  });

  it('空の配列も残す', () => {
    expect(safeMeta({ ids: [] })).toEqual({ ids: [] });
  });

  it('配列の中のオブジェクトからも秘匿値を除く', () => {
    expect(
      safeMeta({ users: [{ email: 'a@example.com', password: 'x' }] }),
    ).toEqual({ users: [{ email: 'a@example.com' }] });
  });
});

describe('対象 ID の取り出し (#90)', () => {
  const {
    targetIdOf,
  } = require('../../../src/modules/audit/audit.interceptor');

  // 引数名は mutation ごとに違う。決め打ちの ?? 連鎖だと
  // 別の値（workspaceId 等）が入り、誤った対象を指す監査ログになる
  it.each([
    ['doc.publish', { workspaceId: 'ws-1', pageId: 'page-1' }, 'page-1'],
    ['doc.unpublish', { workspaceId: 'ws-1', pageId: 'page-1' }, 'page-1'],
    ['doc.restore', { workspaceId: 'ws-1', guid: 'guid-1' }, 'guid-1'],
    ['doc.update', { workspaceId: 'ws-1', docId: 'doc-1' }, 'doc-1'],
  ])('%s は対象のドキュメントを指す', (action, args, expected) => {
    expect(targetIdOf(action, args)).toBe(expected);
  });

  it('ワークスペース操作はワークスペースを指す', () => {
    expect(targetIdOf('workspace.delete', { workspaceId: 'ws-1' })).toBe('ws-1');
  });

  it('ユーザー操作はユーザーを指す', () => {
    expect(targetIdOf('user.delete', { userId: 'u-1' })).toBe('u-1');
  });

  // 作成系は引数に対象 ID が無く、結果にしかない
  it('引数に無ければ結果の id を使う', () => {
    expect(targetIdOf('user.create', { input: {} }, 'created-1')).toBe(
      'created-1',
    );
  });

  it('どこにも無ければ undefined', () => {
    expect(targetIdOf('workspace.create', {})).toBeUndefined();
  });

  // メンバー操作の対象はワークスペースではなく利用者。
  // 接頭辞だけで決めると「誰を外したのか」が分からない記録になる
  it.each([
    'workspace.member.remove',
    'workspace.member.role',
    'workspace.member.approve',
  ])('%s は対象メンバーを指す', (action) => {
    expect(targetIdOf(action, { workspaceId: 'ws-1', userId: 'u-1' })).toBe(
      'u-1',
    );
  });

  it('招待の受諾は招待 ID を対象にする', () => {
    expect(
      targetIdOf('workspace.member.accept', {
        workspaceId: 'ws-1',
        inviteId: 'inv-1',
      }),
    ).toBe('inv-1');
  });

  // 対象が空だと「何の設定を変えたのか」が分からない
  it('SSO 設定は単一の対象を指す', () => {
    expect(targetIdOf('sso.config.update', { input: {} })).toBe('oidc');
  });
});

describe('対応表の整合 (#90)', () => {
  const fs = require('fs');
  const path = require('path');

  // ⚠️ MUTATION_ACTIONS は GraphQL のフィールド名と完全一致で引く。
  // 名前が1文字でも違うと黙って記録されない。実際に inviteMember /
  // revoke / updateWorkspace という存在しない名前を書いており、
  // メンバーの招待・削除が1件も記録されていなかった。
  it('対応表のキーがすべて実在の mutation である', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../src/modules/audit/audit.interceptor.ts'),
      'utf-8',
    );
    const block = src.slice(
      src.indexOf('const MUTATION_ACTIONS'),
      src.indexOf('@Injectable()'),
    );
    const keys = [...block.matchAll(/^\s{2}([a-zA-Z]+):\s*'/gm)].map(
      (m: any) => m[1],
    );
    expect(keys.length).toBeGreaterThan(10);

    const resolverDir = path.join(__dirname, '../../../src/modules');
    const collect = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: any) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return collect(full);
        return e.name.endsWith('.resolver.ts') ? [full] : [];
      });

    const mutations = new Set<string>();
    for (const file of collect(resolverDir)) {
      const text = fs.readFileSync(file, 'utf-8');
      for (const m of text.matchAll(/@Mutation\([\s\S]{0,120}?async (\w+)\(/g)) {
        mutations.add((m as any)[1]);
      }
    }

    const missing = keys.filter((k) => !mutations.has(k));
    expect(missing).toEqual([]);
  });
});

describe('操作名の翻訳 (#90)', () => {
  const fs = require('fs');
  const path = require('path');

  /** コードから実際に出力されうる action を集める。 */
  const emittedActions = (): Set<string> => {
    const root = path.join(__dirname, '../../../src');
    const collect = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: any) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return collect(full);
        return e.name.endsWith('.ts') ? [full] : [];
      });

    // action は `<対象>.<操作>` 形式（docs/logging.md 2.3）。
    // 対応表の値・action: 'x' の直書き・引数渡し・三項演算子など
    // 書き方が複数あるため、**接頭辞で拾う**のが確実。
    const PREFIXES = [
      'admin.',
      'auth.',
      'user.',
      'workspace.',
      'doc.',
      'setting.',
      'backup.',
      'sso.',
      'audit.',
      'security.',
    ];
    const actions = new Set<string>();
    for (const file of collect(root)) {
      const text = fs.readFileSync(file, 'utf-8');
      for (const m of text.matchAll(/'([a-z]+(?:\.[a-z]+)+)'/g)) {
        const value = (m as any)[1];
        if (PREFIXES.some((p) => value.startsWith(p))) actions.add(value);
      }
    }
    return actions;
  };

  const labels = (): Set<string> => {
    const ja = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          '../../../../frontend/packages/frontend/i18n/src/resources/ja.json',
        ),
        'utf-8',
      ),
    );
    const prefix = 'com.affine.admin.audit.action.';
    return new Set(
      Object.keys(ja)
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length)),
    );
  };

  // ⚠️ 片方向（表→mutation）だけでは、翻訳の抜けも残骸も見つからない。
  // 実際に workspace.member.accept 等の翻訳が抜け、workspace.update が
  // 残骸として残っていた
  it('出力される操作に翻訳がある', () => {
    const emitted = [...emittedActions()].filter((a) => a.includes('.'));
    const has = labels();
    const missing = emitted.filter((a) => !has.has(a));
    expect(missing).toEqual([]);
  });

  it('使われていない翻訳が残っていない', () => {
    const emitted = emittedActions();
    const unused = [...labels()].filter((a) => !emitted.has(a));
    expect(unused).toEqual([]);
  });
});

describe('Date 引数の記録 (#90)', () => {
  const { safeMeta } = require('../../../src/modules/audit/audit.interceptor');

  // Object.entries(new Date()) は [] になり、そのままだと黙って消える。
  // recoverDoc の timestamp（復元点）が失われ、何に戻したのか分からなくなる
  it('Date は ISO 文字列として残す', () => {
    const timestamp = new Date('2026-08-02T01:23:45.000Z');
    expect(safeMeta({ timestamp })).toEqual({
      timestamp: '2026-08-02T01:23:45.000Z',
    });
  });
});

describe('記録一覧（マトリクス）の整合 (#90)', () => {
  const fs = require('fs');
  const path = require('path');

  /**
   * ⚠️ 表と実装がずれたら、表を見た人が「記録されている」と誤解する。
   * **docs/logging.md 2.4.1 に載っていない action を出力してはいけない。**
   */
  it('出力されるすべての action が記録一覧に載っている', () => {
    const doc = fs.readFileSync(
      path.join(__dirname, '../../../../docs/logging.md'),
      'utf-8',
    );
    const section = doc.slice(
      doc.indexOf('### 2.4.1'),
      doc.indexOf('### 2.5'),
    );
    const listed = new Set<string>();
    for (const m of section.matchAll(/`([a-z]+(?:\.[a-z]+)+)`/g)) {
      listed.add((m as any)[1]);
    }

    const PREFIXES = [
      'admin.',
      'auth.',
      'user.',
      'workspace.',
      'doc.',
      'setting.',
      'backup.',
      'sso.',
      'audit.',
      'security.',
    ];
    const collect = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: any) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return collect(full);
        return e.name.endsWith('.ts') ? [full] : [];
      });

    const emitted = new Set<string>();
    for (const file of collect(path.join(__dirname, '../../../src'))) {
      const text = fs.readFileSync(file, 'utf-8');
      for (const m of text.matchAll(/'([a-z]+(?:\.[a-z]+)+)'/g)) {
        const value = (m as any)[1];
        if (PREFIXES.some((p) => value.startsWith(p))) emitted.add(value);
      }
    }

    const missing = [...emitted].filter((a) => !listed.has(a));
    expect(missing).toEqual([]);
  });
});

/**
 * #97: ドキュメント単位の権限変更が監査ログに残ること
 * （docs/doc-permission.md 9章）。
 *
 * ⚠️ **「誰がいつ、誰に何を見せるようにしたか」が追えないと、
 * 情報漏洩の調査ができない。**
 */
describe('ドキュメント権限の監査ログ (#97)', () => {
  const {
    flattenArgs,
    safeMeta,
    targetIdOf,
    // eslint-disable-next-line @typescript-eslint/no-var-requires
  } = require('../../../src/modules/audit/audit.interceptor');

  /**
   * ⚠️ #97 の権限操作は `input: { ... }` 形式で届く。
   * 平らにしないと `args.docId` が引けず、**対象が空の監査ログ**になる。
   * 「記録している」のに「何に対する操作か分からない」記録は調査に使えない。
   */
  it('input の中身を平らにする', () => {
    expect(
      flattenArgs({ input: { workspaceId: 'ws-1', docId: 'doc-1' } }),
    ).toEqual({ workspaceId: 'ws-1', docId: 'doc-1' });
  });

  it('input が無い呼び出しはそのまま', () => {
    expect(flattenArgs({ workspaceId: 'ws-1' })).toEqual({ workspaceId: 'ws-1' });
  });

  it.each([
    'doc.permission.grant',
    'doc.permission.revoke',
    'doc.permission.role',
    'doc.permission.default',
  ])('%s の対象は doc である', (action) => {
    const args = flattenArgs({ input: { workspaceId: 'ws-1', docId: 'doc-1' } });
    // ⚠️ workspaceId が入り込むと「どの doc の権限を変えたか」が消える
    expect(targetIdOf(action, args)).toBe('doc-1');
  });

  /** 誰に配ったかが残らないと、漏洩の範囲が特定できない。 */
  it('配った相手とロールが記録に残る', () => {
    const args = flattenArgs({
      input: {
        workspaceId: 'ws-1',
        docId: 'doc-1',
        userIds: ['u-1', 'u-2'],
        role: 'Reader',
      },
    });
    const meta = safeMeta(args);
    expect(meta.userIds).toEqual(['u-1', 'u-2']);
    expect(meta.role).toBe('Reader');
  });

  /** 4つの操作が実際に対応表へ載っていること（載せ忘れは黙って無記録になる）。 */
  it('4つの操作が MUTATION_ACTIONS にある', () => {
    const source = require('fs').readFileSync(
      require('path').join(
        __dirname,
        '../../../src/modules/audit/audit.interceptor.ts',
      ),
      'utf-8',
    );
    for (const [field, action] of [
      ['grantDocUserRoles', 'doc.permission.grant'],
      ['revokeDocUserRoles', 'doc.permission.revoke'],
      ['updateDocUserRole', 'doc.permission.role'],
      ['updateDocDefaultRole', 'doc.permission.default'],
    ]) {
      expect(source).toContain(`${field}: '${action}'`);
    }
  });
});
