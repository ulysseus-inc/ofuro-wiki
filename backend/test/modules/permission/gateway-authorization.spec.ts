import * as fs from 'fs';
import * as path from 'path';

/**
 * #97 段階2-2: **Socket.IO の各経路が、実際に doc 単位の判定を通っていること。**
 *
 * ⚠️ 経路の網羅テスト（`route-coverage.spec.ts`）は
 * 「**表に載っているか**」しか見ない。**載せただけで実装していない**状態は通ってしまう。
 *
 * ここでは**実装側**を見る。各ハンドラの本体に `canDoc` / `filterReadableDocs`
 * の呼び出しがあるかを検査する。
 *
 * > 「表に書いたから大丈夫」を防ぐ。#90 で学んだのと同じ形
 * > （表に無い action は記録されないが、**表にあっても実装が無ければ記録されない**）。
 */
describe('Socket.IO の各経路が doc 単位の判定を通る (#97)', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../../src/modules/sync/sync.gateway.ts'),
    'utf-8',
  );

  /** 指定メッセージのハンドラ本体（次の @SubscribeMessage まで）を切り出す。 */
  const handlerOf = (message: string): string => {
    const start = source.indexOf(`@SubscribeMessage('${message}')`);
    expect(start).toBeGreaterThan(-1);
    const nextIdx = source.indexOf('@SubscribeMessage(', start + 10);
    return source.slice(start, nextIdx === -1 ? undefined : nextIdx);
  };

  /** 1件ずつ判定する経路と、要求するアクション。 */
  const SINGLE_DOC: [string, string][] = [
    ['space:load-doc', 'Doc_Read'],
    ['space:push-doc-update', 'Doc_Update'],
    ['space:delete-doc', 'Doc_Trash'],
    ['space:join-awareness', 'Doc_Read'],
    // ⚠️ awareness は本文を流さないが「誰が開いているか」が漏れる。
    // 仕様書を書いたとき、この2つを見落としていた（6.7）
    ['space:update-awareness', 'Doc_Read'],
    ['space:load-awarenesses', 'Doc_Read'],
  ];

  it.each(SINGLE_DOC)('%s が %s を要求する', (message, action) => {
    const body = handlerOf(message);
    expect(body).toContain('this.canDoc(');
    expect(body).toContain(`'${action}'`);
  });

  /**
   * ⚠️ 一覧は「1件の可否」ではなく「絞り込み」。
   * `canDoc` を呼んでも意味が無く、`filterReadableDocs` を通す必要がある。
   */
  it('space:load-doc-timestamps は一覧を絞り込む', () => {
    const body = handlerOf('space:load-doc-timestamps');
    expect(body).toContain('this.filterReadableDocs(');
  });

  /**
   * ⚠️ **ここに判定ロジックを書かないこと。**
   * ロール名が Gateway に現れたら、権限マトリクスが唯一の正でなくなる。
   */
  it('Gateway にロール名の判定を書いていない', () => {
    // doc のロール名（Owner/Manager/Editor/Commenter/Reader）で分岐していないこと
    const forbidden = [
      "=== 'Owner'",
      "=== 'Manager'",
      "=== 'Editor'",
      "=== 'Commenter'",
      "=== 'Reader'",
    ];
    const found = forbidden.filter((f) => source.includes(f));
    expect({
      Gateway内のロール判定: found,
      対処: '判定は PermissionService に委ね、アクション名だけを渡す',
    }).toEqual({ Gateway内のロール判定: [], 対処: expect.any(String) });
  });

  /**
   * 打鍵のたびに飛ぶ経路があるため、キャッシュが要る。
   * 無いと DB への問い合わせが編集のたびに発生する。
   */
  it('doc 単位の判定にキャッシュがある', () => {
    expect(source).toContain('docAccessCache');
    // ワークスペース単位のキャッシュと同じ寿命・上限を使っていること
    expect(source).toContain('ACCESS_CACHE_TTL_MS');
    expect(source).toContain('ACCESS_CACHE_MAX');
  });
});


/**
 * #97 段階2-3: REST の各経路も doc 単位の判定を通っていること。
 */
describe('REST の各経路が doc 単位の判定を通る (#97)', () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(__dirname, '../../../src/modules', rel), 'utf-8');

  const handlerOf = (source: string, name: string): string => {
    const start = source.indexOf(`async ${name}(`);
    expect(start).toBeGreaterThan(-1);
    // 次のハンドラ（デコレータ）まで
    const next = source.indexOf('\n  @', start);
    return source.slice(start, next === -1 ? undefined : next);
  };

  const CASES: [string, string, string][] = [
    ['doc/doc.controller.ts', 'getDoc', 'canRead'],
    ['doc/doc.controller.ts', 'getDocHistory', 'canRead'],
    ['doc/doc.controller.ts', 'getDocPreview', 'canRead'],
    ['doc/internal-doc.controller.ts', 'upsertDoc', 'canUpdate'],
    // ⚠️ 外部RAG が本文を取り込む経路。ここが抜けると
    // 権限で隠した doc が AI の回答として権限外の人に返る
    ['doc/internal-doc.controller.ts', 'getMarkdown', 'canRead'],
  ];

  it.each(CASES)('%s の %s が permission.%s を通る', (file, name, method) => {
    const body = handlerOf(read(file), name);
    expect(body).toContain(`this.permission.${method}(`);
  });

  /**
   * ⚠️ 読めない doc は「無い」ものとして扱う（仕様書 6.8）。
   * 403 だと「存在するが権限が無い」ことが伝わり、存在を漏らす。
   */
  it('読み取りの拒否は 404（403 ではない）', () => {
    const body = handlerOf(read('doc/doc.controller.ts'), 'getDoc');
    // ⚠️ コメントを除いてから見る。理由を説明する文にも「403」が出るため
    const code = body
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(code).toContain('404');
    expect(code).not.toContain('403');
  });
});


/**
 * #97 段階2-4: GraphQL の各経路も doc 単位の判定を通っていること。
 *
 * ⚠️ GraphQL は `@WorkspaceRole('reader')` のような Guard が付いているため
 * **一見守られているように見える**。だが Guard はワークスペースの入口しか見ない。
 * 「そのワークスペースの reader だが、この doc は読めない」は Guard では表せない。
 */
describe('GraphQL の各経路が doc 単位の判定を通る (#97)', () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(__dirname, '../../../src/modules', rel), 'utf-8');

  const handlerOf = (source: string, name: string): string => {
    const start = source.indexOf(`async ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const next = source.indexOf('\n  @', start);
    return source.slice(start, next === -1 ? undefined : next);
  };

  const DOC_RESOLVER = 'doc/doc.resolver.ts';

  /** 1件ずつ判定する経路と、要求するアクション。 */
  const SINGLE: [string, string, string][] = [
    [DOC_RESOLVER, 'publishPage', 'Doc_Publish'],
    [DOC_RESOLVER, 'revokePublicPage', 'Doc_Publish'],
    // 過去の版を現在に戻す＝本文の書き換え。読めるだけでは足りない
    [DOC_RESOLVER, 'recoverDoc', 'Doc_Update'],
    [DOC_RESOLVER, 'grantDocUserRoles', 'Doc_Users_Manage'],
  ];

  it.each(SINGLE)('%s の %s が %s を要求する', (file, name, action) => {
    const body = handlerOf(read(file), name);
    expect(body).toContain('this.requireDoc(');
    expect(body).toContain(`'${action}'`);
  });

  it.each([
    // ⚠️ 履歴は本文そのもの。読めない doc の履歴を返してはいけない
    [DOC_RESOLVER, 'listHistory'],
    ['workspace/workspace.resolver.ts', 'histories'],
  ])('%s の %s が読み取りを確かめる', (file, name) => {
    expect(handlerOf(read(file), name)).toContain('this.permission.canRead(');
  });

  it('workspaceDocs は一覧を絞り込む', () => {
    // ⚠️ 一覧で canRead を1件ずつ呼ぶと N+1。filterReadable を通すこと
    const body = handlerOf(read(DOC_RESOLVER), 'workspaceDocs');
    expect(body).toContain('this.permission.filterReadable(');
  });

  it('workspace.doc は読めない doc を返さない', () => {
    const body = handlerOf(read('workspace/workspace.resolver.ts'), 'doc');
    expect(body).toContain('this.permission.getDocRole(');
    expect(body).toContain('return null');
  });

  /**
   * ⚠️ 画面はこの `permissions` を見てボタンの表示を決める。
   * **ワークスペースのロールから作ると、doc の設定が画面に反映されない。**
   */
  it('permissions は実効ロールから作られる', () => {
    const source = read('workspace/workspace.resolver.ts');
    expect(source).toContain('roleCan(role,');
    // 旧実装（ワークスペースのロールから組み立てる）が復活していないこと
    expect(source).not.toContain('buildDocPermissions');
  });

  /**
   * ⚠️ 権限を変える操作は、**その場でキャッシュを捨てる**こと（7章）。
   * 忘れると、権限を外したあとも相手のタブで編集が続けられる。
   */
  it.each([
    ['grantDocUserRoles', 'userId'],
    ['revokeDocUserRoles', 'userId'],
    ['updateDocUserRole', 'userId'],
    // 既定ロールは全員に効くため、利用者を指定せず捨てる
    ['updateDocDefaultRole', null],
  ])('%s が判定キャッシュを捨てる', (name, scope) => {
    const body = handlerOf(read(DOC_RESOLVER), name as string);
    expect(body).toContain('this.permission.invalidate(');
    if (scope) {
      expect(body).toMatch(/invalidate\(workspaceId, docId, userId\)/);
    } else {
      expect(body).toMatch(/invalidate\(workspaceId, docId\)/);
    }
  });

  /** 権限を配る・外す操作は Doc_Users_Manage を要求すること。 */
  it.each([
    'revokeDocUserRoles',
    'updateDocUserRole',
    'updateDocDefaultRole',
  ])('%s が Doc_Users_Manage を要求する', (name) => {
    const body = handlerOf(read(DOC_RESOLVER), name);
    expect(body).toContain('this.requireDoc(');
    expect(body).toContain("'Doc_Users_Manage'");
  });

  /**
   * ⚠️ 「誰に権限があるか」は `Doc_Read` では見せない。
   * 閲覧者一覧から人事異動が推測できるなど、組織の運用情報が漏れる。
   */
  it.each([
    // 個人が特定できる。役員限定ページの閲覧者一覧から人事異動が推測できる
    ['grantedUsersList', 'Doc_Users_Read'],
    // ⚠️ 文書の属性であって誰の情報でもない。ここを Doc_Users_Read にすると
    // 共有メニューを開くたびに要求されるため、Editor / Reader が落ちる
    ['defaultRole', 'Doc_Read'],
  ])('%s は %s を要求する', (field, action) => {
    // ⚠️ 呼び出しの形ではなくアクション名で見る。拒否の仕方は項目ごとに違う
    // （defaultRole は例外、grantedUsersList は空を返す。非 null 伝播のため）
    const body = handlerOf(read('permission/doc-type.resolver.ts'), field);
    expect(body).toContain(`'${action}'`);
  });

  /**
   * ⚠️ 共有メニューが開くたびに投げる query に、強い権限が要る項目を
   * 混ぜてはいけない。1項目でも混ざると**問い合わせ全体が失敗する**。
   */
  it('共有情報の query が権限一覧を要求しない', () => {
    const gql = fs.readFileSync(
      path.join(
        __dirname,
        '../../../../frontend/packages/common/graphql/src/graphql/get-workspace-page-by-id.gql',
      ),
      'utf-8',
    );
    expect(gql).not.toContain('grantedUsersList');
  });

  /** ここにも判定を書かない。 */
  it('Resolver にロール名の判定を書いていない', () => {
    const found = ["=== 'Owner'", "=== 'Manager'", "=== 'Editor'", "=== 'Reader'"]
      .filter((f) => read(DOC_RESOLVER).includes(f));
    expect({
      Resolver内のロール判定: found,
      対処: '判定は PermissionService に委ね、アクション名だけを渡す',
    }).toEqual({ Resolver内のロール判定: [], 対処: expect.any(String) });
  });
});


/**
 * #97: **権限の定義が doc-role.ts の1箇所しかないこと。**
 *
 * ⚠️ 以前は workspace.model.ts に buildDocPermissions があり、
 * **ワークスペースのロールから 17 アクションを組み立てていた**。
 * 画面はその値で表示・非表示を決めるため、**第2の権限定義**になっていた。
 *
 * 2つあると必ずずれる。ずれると「編集できないのに編集ボタンが出る」
 * （あるいはその逆で、権限があるのに操作できない）ことになる。
 */
describe('権限の定義が1箇所しかない (#97)', () => {
  const collect = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return collect(full);
      return e.name.endsWith('.ts') ? [full] : [];
    });

  const SRC = path.join(__dirname, '../../../src');

  it('doc-role.ts 以外にアクション名の対応表が無い', () => {
    // 17アクションのうち複数を1ファイルに列挙しているものを探す
    const suspects: string[] = [];
    for (const file of collect(SRC)) {
      if (file.endsWith('doc-role.ts')) continue;
      const text = fs.readFileSync(file, 'utf-8');
      // ⚠️ GraphQL の型定義（`@Field() Doc_Read: boolean;`）は判定ではない。
      // 探すのは「アクション名に真偽値を割り当てている」形だけ
      const assignments = [
        ...text.matchAll(/Doc_[A-Za-z_]+:\s*(true|false|is[A-Z]\w*|\w+\s*(\|\||&&))/g),
      ];
      if (assignments.length >= 3) suspects.push(path.relative(SRC, file));
    }

    expect({
      権限を独自に組み立てているファイル: suspects,
      対処: 'doc-role.ts の roleCan を使う',
    }).toEqual({ 権限を独自に組み立てているファイル: [], 対処: expect.any(String) });
  });
});

/**
 * #97: `defaultRole` は**往復で値が変わらない**こと。
 *
 * ⚠️ 一度、読み出し側で画面の選択肢に寄せる実装にして誤った。
 * `Commenter` を保存すると `Reader` が返り、**画面はその表示値をそのまま
 * 保存に使う**ため、メニューを開いて保存しただけで権限が下がった。
 *
 * **画面が扱えない値は、保存できないようにする側で防ぐ。**
 */
describe('defaultRole は往復で変わらない (#97)', () => {
  const resolver = () =>
    fs.readFileSync(
      path.join(__dirname, '../../../src/modules/permission/doc-type.resolver.ts'),
      'utf-8',
    );

  it('読み出し側で値を寄せていない', () => {
    // 寄せる関数そのものを置かない（置くと必ず往復が壊れる）
    expect(resolver()).not.toContain('displayableDocRole');
  });

  it('保存できる値が画面の選択肢と一致する', () => {
    const source = fs.readFileSync(
      path.join(
        __dirname,
        '../../../../frontend/packages/frontend/core/src/modules/share-menu/view/share-menu/general-access/members-permission.tsx',
      ),
      'utf-8',
    );
    const block = /const getRoleName =[\s\S]*?\n\};/.exec(source);
    expect(block).not.toBeNull();
    const shown = [...block![0].matchAll(/case DocRole\.(\w+):/g)].map((m) => m[1]);

    const {
      DOC_DEFAULT_ROLES,
      // eslint-disable-next-line @typescript-eslint/no-var-requires
    } = require('../../../src/modules/permission/doc-role');

    // ⚠️ 保存できるのに画面が名前を持たない値があると、空欄になる
    expect([...DOC_DEFAULT_ROLES].sort()).toEqual([...shown].sort());
  });

  it('既定ロールの保存が値を検査している', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../src/modules/doc/doc.resolver.ts'),
      'utf-8',
    );
    const start = source.indexOf('async updateDocDefaultRole(');
    const body = source.slice(start, source.indexOf('\n  @', start));
    expect(body).toContain('isDocDefaultRole(role)');
  });
});

/**
 * #97: `DocType` の項目が、権限不足で**親を巻き込まない**こと。
 *
 * ⚠️ GraphQL の非 null 項目で例外を投げると、**非 null 伝播で親まで遡る**。
 * `grantedUsersList` は `PaginatedGrantedDocUserType!` なので、
 * ここで投げると `workspace.doc` ごと `null` になり、
 * `Doc_Users_Read` を持たない Editor / Reader は **title も permissions も失う**。
 * フロントは `denyAll()` に落ちて全操作不可になる。
 *
 * **見せたくないだけなら空を返す。**
 */
describe('権限不足が親のフィールドを壊さない (#97)', () => {
  const source = () =>
    fs.readFileSync(
      path.join(__dirname, '../../../src/modules/permission/doc-type.resolver.ts'),
      'utf-8',
    );

  const bodyOf = (name: string) => {
    const s = source();
    const start = s.indexOf(`async ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const next = s.indexOf('\n  @', start);
    return s.slice(start, next === -1 ? undefined : next);
  };

  it('grantedUsersList は例外を投げず空を返す', () => {
    const body = bodyOf('grantedUsersList');
    expect(body).toContain('EMPTY_GRANTED_USERS');
    // 例外を投げるヘルパーを使っていないこと
    expect(body).not.toContain('this.require(');
  });

  it('それでも Doc_Users_Read は確かめている', () => {
    expect(bodyOf('grantedUsersList')).toContain("'Doc_Users_Read'");
  });
});

/**
 * #97: 移行前のバックアップを復元しても、`defaultRole` が復活しないこと。
 *
 * ⚠️ 移行前のバックアップは**全 doc に旧 DB 既定値 `'reader'` を持つ**。
 * `?? null` は「無いとき」しか効かず、**値として入っているものは素通りする**。
 * 復元しただけで全 doc が「設定済み」になり、所有者が編集できなくなる。
 */
describe('復元が旧既定値を復活させない (#97)', () => {
  const {
    normalizeRestoredDefaultRole,
    // eslint-disable-next-line @typescript-eslint/no-var-requires
  } = require('../../../src/modules/backup/backup.service');

  it.each([
    ['reader', null],
    ['Reader', null],
    [null, null],
    [undefined, null],
    ['', null],
  ])('%s → %s（未設定として扱う）', (input, expected) => {
    expect(normalizeRestoredDefaultRole(input as any)).toBe(expected);
  });

  it.each(['None', 'Editor', 'Manager'])('%s はそのまま残す', (role) => {
    expect(normalizeRestoredDefaultRole(role)).toBe(role);
  });
});

/**
 * #97: **`DocType` の項目が親を巻き込まないこと**（全項目を機械的に検査）。
 *
 * ⚠️ 3巡目のレビューで `grantedUsersList` の非 null 伝播が指摘された。
 * **1件ずつ潰していては終わらない**ため、項目を列挙して総当たりする。
 *
 * GraphQL の非 null 項目で例外を投げると、親まで遡って
 * `workspace.doc` ごと `null` になり、**その doc の title も permissions も
 * 失われる**。見せたくないだけなら空を返すこと。
 */
describe('DocType の項目が親を壊さない (#97)', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../../src/modules/permission/doc-type.resolver.ts'),
    'utf-8',
  );

  /** @ResolveField の項目名と、非 null かどうかを集める。 */
  const fields = [
    ...source.matchAll(
      /@ResolveField\(\(\) => (\w+)(?:,\s*\{([^}]*)\})?\)[\s\S]{0,200}?async (\w+)\(/g,
    ),
  ].map((m) => ({
    name: m[3],
    nullable: /nullable:\s*true/.test(m[2] ?? ''),
  }));

  it('項目を取りこぼしていない', () => {
    expect(fields.length).toBeGreaterThanOrEqual(2);
  });

  it.each(fields.map((f) => [f.name, f.nullable]))(
    '%s（nullable=%s）が非 null なら例外を投げない',
    (name, nullable) => {
      const start = source.indexOf(`async ${name}(`);
      const body = source.slice(start, source.indexOf('\n  @', start));
      const throws = /throw |this\.require\(/.test(body);

      // 非 null 項目で例外を投げると、親の doc ごと null になる
      expect({
        項目: name,
        非null: !nullable,
        例外を投げる: throws,
        対処: '非 null 項目では空を返す。隠すなら nullable にする',
      }).toEqual({
        項目: name,
        非null: !nullable,
        // 非 null なら例外は不可、nullable なら可
        例外を投げる: nullable ? throws : false,
        対処: expect.any(String),
      });
    },
  );
});
