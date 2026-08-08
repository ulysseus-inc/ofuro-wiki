import { PermissionService } from '../../../src/modules/permission/permission.service';
import {
  DOC_ACTIONS,
  DOC_ROLES,
  roleCan,
} from '../../../src/modules/permission/doc-role';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #97: **認可の真理値表**（docs/doc-permission.md 10章）。
 *
 * ⚠️ 経路の網羅テスト（`route-coverage.spec.ts`）が
 * 「**塞ぎ忘れた経路が無いか**」を見るのに対し、
 * ここは「**判定そのものが正しいか**」を見る。**両方要る。**
 *
 * `PermissionService` は今後も書き換わる（性能改善・キャッシュ・条件式化）。
 * **そのたびに壊れていないことを保証できないと、誰も触れなくなる。**
 * 内部をどう書き換えても、外から見た振る舞いをここで固定する。
 */

const WS = '11111111-1111-4111-8111-111111111111';
const DOC = 'doc-1';
const USER = '22222222-2222-4222-8222-222222222222';

interface Setup {
  /** ワークスペースのロール。`null` は非メンバー。 */
  workspace: string | null;
  /** `DocMeta.defaultRole`。`undefined` は doc 自体が無い。 */
  docDefault?: string | null;
  /** `DocPermission[利用者]`。`undefined` は設定なし。 */
  userPerm?: string;
  /** サーバー全体 Admin か。 */
  serverAdmin?: boolean;
}

function makeService(s: Setup): PermissionService {
  const prisma = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ isAdmin: s.serverAdmin === true }),
    },
    workspaceMember: {
      findUnique: jest
        .fn()
        .mockResolvedValue(s.workspace ? { role: s.workspace } : null),
    },
    docPermission: {
      // ⚠️ 「行が無い」(undefined) と「行はあるが role が空」('') を区別する。
      // 混同すると、DB に不正な値が入ったときの挙動を検査できない
      findUnique: jest
        .fn()
        .mockResolvedValue(
          s.userPerm === undefined ? null : { role: s.userPerm },
        ),
      findMany: jest
        .fn()
        .mockResolvedValue(
          s.userPerm === undefined ? [] : [{ docId: DOC, role: s.userPerm }],
        ),
    },
    docMeta: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          s.docDefault === undefined ? null : { defaultRole: s.docDefault },
        ),
      findMany: jest
        .fn()
        .mockResolvedValue(
          s.docDefault === undefined
            ? []
            : [{ docId: DOC, defaultRole: s.docDefault }],
        ),
    },
  };
  return new PermissionService(prisma as unknown as PrismaService);
}

const can = (s: Setup, action: any) =>
  makeService(s).can(WS, DOC, USER, action);

describe('認可の真理値表 (#97)', () => {
  describe('必ず入れるケース（仕様書 10章）', () => {
    it('1. member × 設定なし → 従来どおり読めて書ける', async () => {
      const s: Setup = { workspace: 'member' };
      expect(await can(s, 'Doc_Read')).toBe(true);
      expect(await can(s, 'Doc_Update')).toBe(true);
    });

    /** ⭐ 本 Issue の目的そのもの。 */
    it('2. member × doc既定=None → 読めない（役員限定ページ）', async () => {
      const s: Setup = { workspace: 'member', docDefault: 'None' };
      expect(await can(s, 'Doc_Read')).toBe(false);
      expect(await can(s, 'Doc_Update')).toBe(false);
    });

    it('3. member × doc既定=None × 個別=Reader → 読めるが書けない', async () => {
      const s: Setup = {
        workspace: 'member',
        docDefault: 'None',
        userPerm: 'Reader',
      };
      expect(await can(s, 'Doc_Read')).toBe(true);
      expect(await can(s, 'Doc_Update')).toBe(false);
    });

    it('4. reader × 個別=Editor → 書ける（doc の設定が置換する）', async () => {
      const s: Setup = { workspace: 'reader', userPerm: 'Editor' };
      expect(await can(s, 'Doc_Update')).toBe(true);
    });

    it('5. member × 個別=None → その人だけ読めない', async () => {
      const s: Setup = { workspace: 'member', userPerm: 'None' };
      expect(await can(s, 'Doc_Read')).toBe(false);
    });

    /**
     * ⚠️ 6・7 は最も落としやすい。
     * 「doc の設定が置換する」を素直に実装すると、**ここが通ってしまう。**
     * ワークスペースに居ることは、すべての前提条件である。
     */
    it('6. 非メンバー × doc既定=Reader → 読めない', async () => {
      const s: Setup = { workspace: null, docDefault: 'Reader' };
      expect(await can(s, 'Doc_Read')).toBe(false);
    });

    it('7. 非メンバー × 個別=Reader → 読めない', async () => {
      const s: Setup = { workspace: null, userPerm: 'Reader' };
      expect(await can(s, 'Doc_Read')).toBe(false);
    });

    it('8. サーバー全体 Admin → doc既定=None でも必ず読める（バイパス）', async () => {
      const s: Setup = {
        workspace: null,
        docDefault: 'None',
        userPerm: 'None',
        serverAdmin: true,
      };
      for (const action of DOC_ACTIONS) {
        expect(await can(s, action)).toBe(true);
      }
    });
  });

  /**
   * ⚠️ **ワークスペースの管理者は doc の設定で締め出さない。**
   *
   * 締め出すと、既定ロールを None にした本人が**自分のワークスペースの文書に
   * 入れなくなり、サーバー全体 Admin しか復旧できない**（E2E で検出）。
   *
   * 隠す相手は「同じワークスペースの一般の利用者」であって、
   * そのワークスペースの管理者ではない。管理者はバックアップからも
   * DB からも読めるため、ここで隠しても境界にならない。
   */
  describe('ワークスペース管理者の下限', () => {
    it.each(['owner', 'admin'])(
      '%s は doc既定=None でも締め出されない',
      async (ws) => {
        const s: Setup = { workspace: ws, docDefault: 'None' };
        expect(await can(s, 'Doc_Read')).toBe(true);
        expect(await can(s, 'Doc_Update')).toBe(true);
        // 締め出しを解除できること（これが無いと復旧できない）
        expect(await can(s, 'Doc_Users_Manage')).toBe(true);
      },
    );

    it('個別に None を当てても管理者は締め出されない', async () => {
      const s: Setup = { workspace: 'owner', userPerm: 'None' };
      expect(await can(s, 'Doc_Read')).toBe(true);
    });

    /** ⚠️ 一般の利用者には効くこと（下限が効きすぎていないか）。 */
    it.each(['member', 'reader'])('%s は doc既定=None で締め出される', async (ws) => {
      expect(await can({ workspace: ws, docDefault: 'None' }, 'Doc_Read')).toBe(
        false,
      );
    });

    it('一覧でも管理者は落とされない', async () => {
      const service = makeService({ workspace: 'owner', docDefault: 'None' });
      expect(await service.filterReadable(WS, [DOC], USER)).toEqual([DOC]);
    });

    it('検索でも管理者は絞られない', async () => {
      const service = makeService({ workspace: 'owner', docDefault: 'None' });
      const f = await service.readableDocFilter(WS, USER, 2);
      expect(f.sql).toBe('true');
    });
  });

  describe('優先順位（個別 > doc既定 > ワークスペース）', () => {
    it('個別が doc既定に勝つ', async () => {
      // doc既定は Reader だが、個別が Editor
      const s: Setup = {
        workspace: 'reader',
        docDefault: 'Reader',
        userPerm: 'Editor',
      };
      expect(await can(s, 'Doc_Update')).toBe(true);
    });

    it('doc既定がワークスペースに勝つ', async () => {
      // ワークスペースは member(Editor) だが、doc既定が Reader
      const s: Setup = { workspace: 'member', docDefault: 'Reader' };
      expect(await can(s, 'Doc_Update')).toBe(false);
      expect(await can(s, 'Doc_Read')).toBe(true);
    });

    it('どちらも無ければワークスペース', async () => {
      expect(await can({ workspace: 'owner' }, 'Doc_Delete')).toBe(true);
      expect(await can({ workspace: 'member' }, 'Doc_Delete')).toBe(false);
    });
  });

  describe('ワークスペースのロール対応', () => {
    const cases: [string, string, boolean][] = [
      ['owner', 'Doc_Delete', true],
      ['admin', 'Doc_Delete', true],
      ['member', 'Doc_Update', true],
      ['member', 'Doc_Delete', false],
      ['member', 'Doc_Publish', false],
      ['reader', 'Doc_Read', true],
      ['reader', 'Doc_Update', false],
      ['reader', 'Doc_Comments_Create', false],
    ];
    it.each(cases)('%s は %s = %s', async (ws, action, expected) => {
      expect(await can({ workspace: ws }, action)).toBe(expected);
    });
  });

  describe('安全側の既定', () => {
    /** ⚠️ DB に想定外の文字列が入っていても、読める側へ倒さない。 */
    it('未知のロール名はアクセス不可として扱う', async () => {
      const s: Setup = { workspace: 'member', userPerm: 'SuperUser' };
      expect(await can(s, 'Doc_Read')).toBe(false);
    });

    it('空文字のロールもアクセス不可', async () => {
      expect(
        await can({ workspace: 'member', userPerm: '' }, 'Doc_Read'),
      ).toBe(false);
    });
  });

  describe('filterReadable（一覧の絞り込み）', () => {
    it('読めない doc を落とす', async () => {
      const service = makeService({ workspace: 'member', docDefault: 'None' });
      expect(await service.filterReadable(WS, [DOC], USER)).toEqual([]);
    });

    it('読める doc は残す', async () => {
      const service = makeService({ workspace: 'member' });
      expect(await service.filterReadable(WS, [DOC], USER)).toEqual([DOC]);
    });

    it('非メンバーには1件も返さない', async () => {
      const service = makeService({ workspace: null, docDefault: 'Reader' });
      expect(await service.filterReadable(WS, [DOC], USER)).toEqual([]);
    });

    it('Admin には全件返す', async () => {
      const service = makeService({
        workspace: null,
        docDefault: 'None',
        serverAdmin: true,
      });
      expect(await service.filterReadable(WS, [DOC], USER)).toEqual([DOC]);
    });

    // 1件ずつ判定すると N+1 になる。まとめて引いていること
    it('doc の件数によらず問い合わせ回数が増えない', async () => {
      const service = makeService({ workspace: 'member' });
      const prisma = (service as any).prisma;
      await service.filterReadable(WS, ['a', 'b', 'c', 'd', 'e'], USER);
      expect(prisma.docPermission.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.docMeta.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('readableDocFilter（検索の条件）', () => {
    it('非メンバーは1件も読めない条件になる', async () => {
      const service = makeService({ workspace: null });
      const f = await service.readableDocFilter(WS, USER, 2);
      expect(f.sql).toBe('false');
    });

    it('Admin は条件を足さない', async () => {
      const service = makeService({ workspace: 'member', serverAdmin: true });
      const f = await service.readableDocFilter(WS, USER, 2);
      expect(f.sql).toBe('true');
      expect(f.join).toBe('');
    });

    // ⚠️ 呼び出し側の $1 と衝突すると、検索が壊れるか権限が誤る
    it('位置パラメータが指定した番号から始まる', async () => {
      const service = makeService({ workspace: 'member' });
      const f = await service.readableDocFilter(WS, USER, 5);
      expect(f.sql).toContain('$5');
      expect(f.sql).toContain('$6');
      expect(f.join).toContain('$7');
      expect(f.params).toHaveLength(3);
    });

    it('4.2 の優先順位が SQL に現れている', async () => {
      const service = makeService({ workspace: 'member' });
      const f = await service.readableDocFilter(WS, USER, 2);
      // 個別(dp) を doc既定(dm) より先に見ていること
      expect(f.sql.indexOf('dp.role')).toBeLessThan(
        f.sql.indexOf('dm.default_role'),
      );
    });
  });
});

/**
 * 権限マトリクス（仕様書5章）そのものの検査。
 *
 * ⚠️ 表を変えたときに、意図しない緩和が入っていないかを見る。
 */
describe('権限マトリクス (#97)', () => {
  it('None は何もできない', () => {
    for (const action of DOC_ACTIONS) {
      expect(roleCan('None', action)).toBe(false);
    }
  });

  it('Owner はすべてできる', () => {
    for (const action of DOC_ACTIONS) {
      expect(roleCan('Owner', action)).toBe(true);
    }
  });

  it('削除できるのは Owner だけ', () => {
    const deleters = DOC_ROLES.filter((r) => roleCan(r, 'Doc_Delete'));
    expect(deleters).toEqual(['Owner']);
  });

  it('権限を配れるのは Owner と Manager だけ', () => {
    const managers = DOC_ROLES.filter((r) => roleCan(r, 'Doc_Users_Manage'));
    expect(managers).toEqual(['Owner', 'Manager']);
  });

  // 公開ページから社内の運用情報（誰が権限を持つか等）が漏れないこと
  it('External は読むだけ', () => {
    const allowed = DOC_ACTIONS.filter((a) => roleCan('External', a));
    expect(allowed).toEqual(['Doc_Read']);
  });

  // 読めないのに書ける、というロールがあってはならない
  it('書けるロールは必ず読める', () => {
    for (const role of DOC_ROLES) {
      if (roleCan(role, 'Doc_Update')) {
        expect(roleCan(role, 'Doc_Read')).toBe(true);
      }
    }
  });
});

/**
 * #97: GraphQL の `DocRole` 列挙が、フロントの契約と一致すること。
 *
 * ⚠️ フロント（`frontend/packages/common/graphql/src/schema.ts`）は
 * **既にこの列挙を前提に書かれている**。ずれると、権限 UI が
 * 「不正な値」を送って黙って失敗する。
 *
 * ⚠️ **バックエンド側は手で並べないこと。** `doc-role.ts` から引くことで、
 * 5章の表を変えたときに GraphQL 側も自動で追従する。
 */
describe('DocRole 列挙がフロントの契約と一致する (#97)', () => {
  it('列挙値が一致する', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(
        __dirname,
        '../../../../frontend/packages/common/graphql/src/schema.ts',
      ),
      'utf-8',
    );
    const block = /export enum DocRole \{([\s\S]*?)\}/.exec(source);
    expect(block).not.toBeNull();
    const frontend = [...block![1].matchAll(/(\w+) = '/g)].map((m) => m[1]);

    expect([...DOC_ROLES].sort()).toEqual(frontend.sort());
  });
});

/**
 * #97: 権限を変えたら、判定のキャッシュがその場で捨てられること
 * （docs/doc-permission.md 7章）。
 *
 * ⚠️ **寿命切れを待ってはいけない。** 待つと
 * 「権限を外したのに、相手の開いているタブでは編集が続けられる」時間が生まれる。
 * 認可としては最も分かりにくい抜けで、テストが無いと気づけない。
 */
describe('権限変更時のキャッシュ破棄 (#97)', () => {
  it('登録した購読者へ伝わる', () => {
    const service = makeService({ workspace: 'member' });
    const calls: unknown[][] = [];
    service.onInvalidate((...args) => calls.push(args));

    service.invalidate(WS, DOC, USER);
    expect(calls).toEqual([[WS, DOC, USER]]);
  });

  /** 既定ロールの変更は全員の判定に効くため、利用者を指定せず捨てる。 */
  it('利用者を指定しない破棄も伝わる', () => {
    const service = makeService({ workspace: 'member' });
    const calls: unknown[][] = [];
    service.onInvalidate((...args) => calls.push(args));

    service.invalidate(WS, DOC);
    expect(calls).toEqual([[WS, DOC, undefined]]);
  });

  /**
   * ⚠️ **各モジュールが `providers` に PermissionService を並べると
   * インスタンスが別々になり、破棄が他モジュールへ届かない。**
   * 判定は正しいのに編集が続く、という形で表面化する。
   */
  it('PermissionModule だけが PermissionService を提供する', () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '../../../src/modules');

    const offenders: string[] = [];
    for (const mod of fs.readdirSync(dir)) {
      const file = path.join(dir, mod, `${mod}.module.ts`);
      if (!fs.existsSync(file)) continue;
      if (mod === 'permission') continue;
      const text: string = fs.readFileSync(file, 'utf-8');
      // providers に並べていたら別インスタンスになる
      if (/providers:[\s\S]*?PermissionService/.test(text)) offenders.push(mod);
    }

    expect({
      別インスタンスを作るモジュール: offenders.sort(),
      対処: 'PermissionModule は @Global。providers から外す',
    }).toEqual({ 別インスタンスを作るモジュール: [], 対処: expect.any(String) });
  });

  it('PermissionModule が @Global である', () => {
    const fs = require('fs');
    const path = require('path');
    const text = fs.readFileSync(
      path.join(__dirname, '../../../src/modules/permission/permission.module.ts'),
      'utf-8',
    );
    expect(text).toContain('@Global()');
  });
});

/**
 * #97: 画面側の「すべて不可」の一覧が、権限マトリクスと一致すること。
 *
 * ⚠️ 読めない doc では `workspace.doc` が `null` を返すため、画面は
 * 自前で「すべて不可」を組み立てる。**ここが漏れると、増やした
 * アクションだけ `undefined`（＝falsy だが未定義）になり、
 * 判定できない項目が生まれる。**
 */
describe('画面側の既定（すべて不可）がマトリクスと一致する (#97)', () => {
  it('アクションの一覧が一致する', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(
        __dirname,
        '../../../../frontend/packages/frontend/core/src/modules/permissions/stores/guard.ts',
      ),
      'utf-8',
    );
    const block = /const actions = \[([\s\S]*?)\] as const;/.exec(source);
    expect(block).not.toBeNull();
    const frontend = [...block![1].matchAll(/'(\w+)'/g)].map((m) => m[1]);

    expect(frontend.sort()).toEqual([...DOC_ACTIONS].sort());
  });
});

/**
 * #97: `DocMeta.defaultRole` の「未設定」が NULL であること。
 *
 * ⚠️ **既定値を入れてはいけない。** 以前この列は `@default("reader")` で、
 * doc を作った瞬間に「ドキュメントの設定がある」状態になっていた。
 * 4.2 の②はドキュメントの設定をワークスペースのロールより優先するため、
 * **所有者を含む全員が Reader に降格し、自分の doc を編集できなくなる。**
 *
 * 単体テストは素通りした（モックが未設定を渡していた）。**E2E で初めて出た。**
 */
describe('defaultRole の未設定は NULL (#97)', () => {
  const read = (rel: string) => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '../../../', rel), 'utf-8');
  };

  it('スキーマが既定値を持たない', () => {
    const block = /model DocMeta \{([\s\S]*?)\n\}/.exec(read('prisma/schema.prisma'));
    expect(block).not.toBeNull();
    const line = block![1]
      .split('\n')
      .find((l) => l.trim().startsWith('defaultRole'));
    expect(line).toBeDefined();
    // 省略可能（?）であり、既定値を持たないこと
    expect(line).toContain('String?');
    expect(line).not.toContain('@default');
  });

  /**
   * 復元で埋め戻すと、バックアップから戻した瞬間に全 doc が壊れる。
   *
   * ⚠️ **書き方ではなく振る舞いで見る。** 以前は
   * `?? null` という字面を検査していたが、それでは
   * 「値として 'reader' が入っている」場合を見逃す
   * （移行前のバックアップは全 doc がそれ）。
   */
  it('復元しても既定値が復活しない', () => {
    const {
      normalizeRestoredDefaultRole,
      // eslint-disable-next-line @typescript-eslint/no-var-requires
    } = require('../../../src/modules/backup/backup.service');
    expect(normalizeRestoredDefaultRole('reader')).toBeNull();
    expect(normalizeRestoredDefaultRole(null)).toBeNull();
    expect(normalizeRestoredDefaultRole('None')).toBe('None');

    // 復元経路が実際にそれを通していること
    expect(read('src/modules/backup/backup.service.ts')).toContain(
      'defaultRole: normalizeRestoredDefaultRole(',
    );
  });

  /** 未設定ならワークスペースのロールが効くこと（判定そのもの）。 */
  it('未設定の doc では所有者が所有者のまま', async () => {
    const s: Setup = { workspace: 'owner', docDefault: null };
    expect(await can(s, 'Doc_Update')).toBe(true);
    expect(await can(s, 'Doc_Users_Manage')).toBe(true);
    expect(await can(s, 'Doc_Delete')).toBe(true);
  });
});

/**
 * #97: 検索へ差し込む条件が、検索の SQL を壊さないこと。
 *
 * ⚠️ **壊れた検索は空を返す。** つまり
 * 「権限で隠せている」ように見えてしまい、**否定側の検査が素通りする。**
 * 実際に2回起きた（`doc_id is ambiguous` と `tableoid does not exist`）。
 */
describe('検索の条件が SQL を壊さない (#97)', () => {
  const read = () => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(
      path.join(__dirname, '../../../src/modules/search/search.service.ts'),
      'utf-8',
    );
  };

  /**
   * ⚠️ ふつうの LEFT JOIN は `doc_id` / `workspace_id` を持ち込み、
   * 検索側の裸の列名を曖昧にする。LATERAL で必要な列だけ出すこと。
   */
  it('結合が余計な列を持ち込まない', async () => {
    const service = makeService({ workspace: 'member' });
    const f = await service.readableDocFilter(WS, USER, 2);
    expect(f.join).toContain('LEFT JOIN LATERAL');
    // 権限に使う列だけを出していること
    expect(f.join).toContain('SELECT dp0.role');
    expect(f.join).toContain('SELECT dm0.default_role');
  });

  /**
   * ⚠️ `tableoid` / `ctid` はシステム列で、結合をまたぐと解決できない。
   * 修飾を外すと `column "tableoid" does not exist` で検索が落ちる。
   */
  it('スコアのシステム列が修飾されている', () => {
    const source = read();
    expect(source).not.toMatch(/pgroonga_score\(tableoid/);
    expect(source).toContain(
      'pgroonga_score(search_index.tableoid, search_index.ctid)',
    );
  });

  /** 3つの API 経路すべてが条件を作っていること。 */
  it('検索の3経路すべてが条件を作る', () => {
    expect(read().match(/readableDocFilter\(/g)?.length).toBe(3);
  });

  /**
   * ⚠️ **経路の数と SQL の本数は一致しない。**
   * aggregate は「グループ取得」と「各グループの中身取得」の**2本**を投げる。
   * 以前ここを `perm.join` の出現数 === 3 で検査しており、
   * **4本目（hitsSql）の結合漏れを見逃した**。
   * その結果、通常のメンバーだけ集約検索が 500 になっていた
   * （Admin と WS 所有者は条件が `true` になるため気づけない）。
   *
   * 数を決め打ちせず、**条件を使う SQL には必ず結合がある**ことを見る。
   */
  it('権限条件を使う SQL には必ず結合が付いている', () => {
    const source = read();
    // search_index から引くテンプレートリテラルをすべて取り出す
    const statements = [...source.matchAll(/`SELECT[\s\S]*?`/g)].map((m) => m[0]);
    const usesPermission = statements.filter(
      (sql) => sql.includes('fullWhere') || sql.includes('perm.sql'),
    );
    expect(usesPermission.length).toBeGreaterThanOrEqual(3);

    const missing = usesPermission.filter((sql) => !sql.includes('perm.join'));
    expect({
      結合が無いSQL: missing.map((s) => s.slice(0, 60)),
      対処: 'FROM search_index${perm.join} にする',
    }).toEqual({ 結合が無いSQL: [], 対処: expect.any(String) });
  });
});

/**
 * #97: `External` は実効ロールの評価対象外であること。
 *
 * ⚠️ **4.2 の⓪「非メンバーは不許可」と `External` の `Doc_Read` は、
 * そのままでは矛盾する。** `External` を実効ロールとして返すと、
 * ⓪ を回避する抜け道になる。
 *
 * `External` は公開共有トークンによる**別の認証経路**専用であり、
 * ワークスペースのメンバーシップを前提にしない。
 */
describe('External は実効ロールに現れない (#97)', () => {
  it('DB に External が入っていても実効ロールにしない', async () => {
    // ⚠️ `toDocRole('External')` は 'External' を返す（マトリクス上は正当な値）。
    // それでも getDocRole が返してはいけない
    const service = makeService({ workspace: 'member', userPerm: 'External' });
    const role = await service.getDocRole(WS, DOC, USER);
    expect(role).not.toBe('External');
  });

  it('doc の既定が External でも実効ロールにしない', async () => {
    const service = makeService({ workspace: 'member', docDefault: 'External' });
    expect(await service.getDocRole(WS, DOC, USER)).not.toBe('External');
  });

  /** ⚠️ 非メンバーは、External が絡んでも通さない（⓪ の維持）。 */
  it('非メンバーは External でも通さない', async () => {
    const s: Setup = { workspace: null, userPerm: 'External' };
    expect(await can(s, 'Doc_Read')).toBe(false);
  });

  /** 公開共有の経路ができるまで、External を作る実装が無いこと。 */
  it('実効ロールを計算する側に External が書かれていない', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../../../src/modules/permission/permission.service.ts'),
      'utf-8',
    );
    expect(source).not.toContain("'External'");
  });
});

/**
 * #97: **権限昇格ができないこと**（総当たり）。
 *
 * ⚠️ `Doc_Users_Manage` を持つのは Owner と Manager。
 * 「配る権限がある」と「何でも配れる」は別である。
 * Manager が `Owner` を配れると**自分を Owner に昇格でき**、
 * `Doc_TransferOwner` / `Doc_Delete` まで得られる。
 *
 * 指摘待ちをやめ、**7ロール × 7ロールを機械的に潰す。**
 */
describe('権限昇格の総当たり (#97)', () => {
  const {
    canGrantDocRole,
    // eslint-disable-next-line @typescript-eslint/no-var-requires
  } = require('../../../src/modules/permission/doc-role');

  /** 配る側 × 配られる側のすべての組み合わせ。 */
  const pairs = DOC_ROLES.flatMap((actor) =>
    DOC_ROLES.map((target) => [actor, target] as const),
  );

  it('自分より強いロールは配れない（49通り）', () => {
    const violations: string[] = [];
    for (const [actor, target] of pairs) {
      if (!canGrantDocRole(actor, target)) continue;
      // 配れると判定された組み合わせは、配る側が持つ権限の範囲内であること
      const escalated = DOC_ACTIONS.filter(
        (a) => roleCan(target, a) && !roleCan(actor, a),
      );
      if (escalated.length > 0) {
        violations.push(`${actor} → ${target}: ${escalated.join(',')}`);
      }
    }
    expect({
      昇格できる組み合わせ: violations,
      対処: 'canGrantDocRole で塞ぐ',
    }).toEqual({ 昇格できる組み合わせ: [], 対処: expect.any(String) });
  });

  it('Manager は Owner を配れない', () => {
    expect(canGrantDocRole('Manager', 'Owner')).toBe(false);
    expect(canGrantDocRole('Manager', 'Manager')).toBe(true);
  });

  /** External は公開共有トークン専用。メンバーへ配るものではない。 */
  it('誰も External は配れない', () => {
    for (const actor of DOC_ROLES) {
      expect(canGrantDocRole(actor, 'External')).toBe(false);
    }
  });

  /** 配る側の実装が、実際にこの検査を通っていること。 */
  it.each(['grantDocUserRoles', 'updateDocUserRole'])(
    '%s が付与するロールを検査している',
    (name) => {
      const fs = require('fs');
      const path = require('path');
      const source = fs.readFileSync(
        path.join(__dirname, '../../../src/modules/doc/doc.resolver.ts'),
        'utf-8',
      );
      const start = source.indexOf(`async ${name}(`);
      const body = source.slice(start, source.indexOf('\n  @', start));
      expect(body).toContain('this.requireGrantable(');
    },
  );
});
