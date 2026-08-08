import * as fs from 'fs';
import * as path from 'path';

/**
 * #97 段階0: **ドキュメントを外に出す経路が、すべて仕様書の表に載っていること。**
 *
 * ⚠️ **これは「認可が正しいか」を見るテストではない。**
 * 「**認可を考えた形跡があるか**」を見る。
 *
 * ページ単位の権限は**1箇所漏れると情報漏洩**になる。
 * しかも漏れ方が静かで、「一覧に1行余計に出る」だけなので気づけない。
 *
 * そこで `docs/doc-permission.md` 6.1 の表を**唯一の正**とし、
 * **表に無い経路が実装に増えたら落とす。**
 *
 * 新しい経路を足した人は、表に1行足して「どう判定するか」を書く必要がある。
 * **「判定不要」と書くのも立派な決定**であり、書かずに素通りさせないことが目的。
 *
 * ---
 *
 * この方式は #90（監査ログの記録一覧）で有効性が確認できている。
 * 表を作った結果、7巡のレビューで出なかった記録漏れが3件見つかった。
 */
describe('ドキュメントを出す経路が仕様書の表に載っている (#97)', () => {
  const root = path.join(__dirname, '../../..');
  const spec = fs.readFileSync(
    path.join(root, '../docs/doc-permission.md'),
    'utf-8',
  );

  /** 仕様書 6.1 の表に載っている経路。 */
  const documented = (): Set<string> => {
    const start = spec.indexOf('### 6.1 記録一覧');
    const end = spec.indexOf('### 6.2 ');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const listed = new Set<string>();
    for (const line of spec.slice(start, end).split('\n')) {
      // 表の1列目のバッククォート内だけを拾う
      const m = /^\|\s*`([^`]+)`\s*\|/.exec(line);
      if (m) listed.add(m[1]);
    }
    return listed;
  };

  const read = (rel: string) =>
    fs.readFileSync(path.join(root, 'src/modules', rel), 'utf-8');

  describe('Socket.IO', () => {
    /**
     * ⚠️ Yjs の同期は**すべてドキュメントに触る**。
     * ここに増えた経路は、まず間違いなく認可が要る。
     */
    it('sync.gateway のすべてのメッセージが表にある', () => {
      const source = read('sync/sync.gateway.ts');
      const found = [...source.matchAll(/@SubscribeMessage\('([^']+)'\)/g)].map(
        (m) => m[1],
      );
      expect(found.length).toBeGreaterThan(0);

      const listed = documented();
      const missing = found.filter((r) => !listed.has(r)).sort();
      expect({
        表に無い経路: missing,
        対処: 'docs/doc-permission.md 6.1 に1行足して、どう判定するかを書く',
      }).toEqual({ 表に無い経路: [], 対処: expect.any(String) });
    });
  });

  describe('REST', () => {
    /**
     * ドキュメントの内容・存在を出しうるコントローラ。
     *
     * ⚠️ **ここにファイルを足したら、この配列にも足すこと。**
     * 配列に無いファイルは検査されない。
     */
    const CONTROLLERS = [
      'doc/doc.controller.ts',
      'doc/internal-doc.controller.ts',
      'blob/blob.controller.ts',
      'backup/backup.controller.ts',
    ];

    /** `@Controller('x')` + `@Get('y')` → `GET /x/y` */
    const routesOf = (source: string): string[] => {
      const prefix = /@Controller\('([^']*)'\)/.exec(source)?.[1] ?? '';
      const out: string[] = [];
      for (const m of source.matchAll(
        /@(Get|Post|Put|Patch|Delete)\('([^']*)'\)/g,
      )) {
        const [, method, sub] = m;
        const p = [prefix, sub].filter(Boolean).join('/');
        out.push(`${method.toUpperCase()} /${p}`);
      }
      return out;
    };

    it('ドキュメントに触るコントローラのすべての経路が表にある', () => {
      const listed = documented();
      const missing: string[] = [];

      for (const file of CONTROLLERS) {
        const found = routesOf(read(file));
        expect(found.length).toBeGreaterThan(0);
        missing.push(...found.filter((r) => !listed.has(r)));
      }

      expect({
        表に無い経路: missing.sort(),
        対処: 'docs/doc-permission.md 6.1 に1行足して、どう判定するかを書く',
      }).toEqual({ 表に無い経路: [], 対処: expect.any(String) });
    });
  });

  /**
   * ⚠️ GraphQL は `@WorkspaceRole('reader')` の Guard が付くため
   * **一見守られて見える**。Guard はワークスペースの入口しか見ないので、
   * doc 単位では何も保証しない。ここで表と突き合わせる。
   */
  describe('GraphQL', () => {
    const RESOLVERS = [
      'doc/doc.resolver.ts',
      'workspace/workspace.resolver.ts',
      // doc の権限を読む項目（defaultRole / grantedUsersList）はここにある
      'permission/doc-type.resolver.ts',
    ];

    /** doc を扱う Query / Mutation / ResolveField の名前を集める。 */
    const fieldsOf = (source: string): string[] => {
      const out: string[] = [];
      for (const m of source.matchAll(
        /@(?:Query|Mutation|ResolveField)\([^)]*\)[\s\S]{0,200}?async (\w+)\(/g,
      )) {
        out.push(m[1]);
      }
      return out;
    };

    /** doc に関係しない項目（ワークスペースやユーザーの操作）は対象外。 */
    const DOC_RELATED = /doc|page|histor|search|aggregate/i;

    it('doc を扱う GraphQL 項目が表にある', () => {
      const listed = documented();
      const missing: string[] = [];

      for (const file of RESOLVERS) {
        for (const name of fieldsOf(read(file))) {
          if (!DOC_RELATED.test(name)) continue;
          // 表は `workspace.doc` のように前置きが付く場合がある
          const ok = [...listed].some(
            (r) => r === name || r.endsWith(`.${name}`) || r.startsWith(`${name} `),
          );
          if (!ok) missing.push(`${file}: ${name}`);
        }
      }

      expect({
        表に無い経路: missing.sort(),
        対処: 'docs/doc-permission.md 6.1 の表に足し、判定を実装する',
      }).toEqual({ 表に無い経路: [], 対処: expect.any(String) });
    });

    /** 表に載っているのに実装が無い GraphQL 項目。 */
    it('表に載っているのに実装に無い GraphQL 項目が無い', () => {
      const implemented = new Set(
        RESOLVERS.flatMap((f) => fieldsOf(read(f))),
      );
      const stale = [...documented()]
        .filter((r) => r.startsWith('workspace.'))
        // 表は `workspace.doc.defaultRole` のように親をたどって書く。
        // 実装名は末尾の項目名なので、そこで照合する
        .filter((r) => !implemented.has(r.split('.').pop() as string));

      expect({
        実装に無い行: stale.sort(),
        対処: '未実装の経路は表から消す（守られていると誤解するため）',
      }).toEqual({ 実装に無い行: [], 対処: expect.any(String) });
    });
  });

  describe('表の健全性', () => {
    // 表そのものが空になっていたら、上の検査はすべて素通りする
    it('表が十分な数の経路を載せている', () => {
      expect(documented().size).toBeGreaterThanOrEqual(15);
    });

    /**
     * ⚠️ 逆方向も見る。実装から消えた経路が表に残っていると、
     * **「守られている」と誤解する行が残る。**
     */
    it('表に載っているのに実装に無い経路が無い（Socket.IO）', () => {
      const source = read('sync/sync.gateway.ts');
      const implemented = new Set(
        [...source.matchAll(/@SubscribeMessage\('([^']+)'\)/g)].map((m) => m[1]),
      );
      const stale = [...documented()]
        .filter((r) => r.startsWith('space:'))
        .filter((r) => !implemented.has(r));

      expect({
        実装に無い行: stale.sort(),
        対処: '実装から消えた経路は表からも消す',
      }).toEqual({ 実装に無い行: [], 対処: expect.any(String) });
    });
  });
});
