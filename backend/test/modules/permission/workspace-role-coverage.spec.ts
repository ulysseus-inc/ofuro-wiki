import * as fs from 'fs';
import * as path from 'path';

/**
 * #285: **`workspaceId` を受け取る GraphQL 項目は、すべて認可を宣言していること。**
 *
 * H-1（2026-07）で共通認可ガードを各リゾルバに付けたとき、対象を「doc を扱うもの」で
 * 選んだため Blob が漏れた。ログインさえすれば、他のワークスペースの画像を
 * 一覧・書き込み・**完全削除**できた（docs/security-review-2026-07-02.md H-1 追補）。
 *
 * ⚠️ これは「認可が正しいか」ではなく「**認可を考えた形跡があるか**」を見る
 * （route-coverage.spec.ts と同じ考え方）。`@WorkspaceRole` が無い項目は、
 * 下の許可リストに理由を書いて載せる。書かずに素通りさせない。
 */
describe('workspaceId を受け取る GraphQL 項目が認可を宣言している (#285)', () => {
  const src = path.join(__dirname, '../../../src/modules');

  /** `@WorkspaceRole` を使わない理由がある項目。`ファイル名#関数名` → 理由 */
  const ALLOWED: Record<string, string> = {
    'permission.resolver.ts#workspaceRole':
      '自分のロールを返すだけ。非メンバーには null が返る',
    'comment.resolver.ts#uploadCommentAttachment':
      '関数内で assertCanComment（createComment と同じ: member 以上・ページを読める）',
    'workspace.resolver.ts#acceptInviteById':
      '招待を受ける前はメンバーでないため（H-1 で意図的に非適用）',
  };

  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return files(p);
      return e.name.endsWith('.resolver.ts') ? [p] : [];
    });

  /** Query / Mutation / ResolveField のうち、引数に workspaceId を取る関数 */
  const handlers = (source: string) => {
    const out: Array<{ name: string; decorators: string }> = [];
    const re =
      /((?:\s*@\w+\((?:[^()]|\([^()]*\))*\)\s*)+)\s*async (\w+)\(([\s\S]*?)\)\s*(?::[^{]*)?\{/g;
    for (const m of source.matchAll(re)) {
      const [, decorators, name, params] = m;
      if (!/@(Query|Mutation|ResolveField)\(/.test(decorators)) continue;
      if (!/['"]workspaceId['"]/.test(params)) continue;
      out.push({ name, decorators });
    }
    return out;
  };

  it('@WorkspaceRole が付いているか、許可リストに理由がある', () => {
    const missing: string[] = [];
    for (const file of files(src)) {
      const source = fs.readFileSync(file, 'utf-8');
      // ⚠️ import しただけでは守られない。@UseGuards に入っていること
      const guarded = /@UseGuards\([^)]*WorkspaceMemberGuard/.test(source);
      for (const h of handlers(source)) {
        const key = `${path.basename(file)}#${h.name}`;
        if (ALLOWED[key]) continue;
        const declared = /@WorkspaceRole\(/.test(h.decorators);
        if (!declared || !guarded) missing.push(key);
      }
    }
    expect({
      認可の無い項目: missing.sort(),
      対処: '@UseGuards(WorkspaceMemberGuard) と @WorkspaceRole(...) を付けるか、ALLOWED に理由を書く',
    }).toEqual({ 認可の無い項目: [], 対処: expect.any(String) });
  });

  it('許可リストに実在しない項目が残っていない', () => {
    const present = new Set<string>();
    for (const file of files(src)) {
      const source = fs.readFileSync(file, 'utf-8');
      for (const h of handlers(source))
        present.add(`${path.basename(file)}#${h.name}`);
    }
    expect(Object.keys(ALLOWED).filter((k) => !present.has(k))).toEqual([]);
  });

  it('⚠️ 検査が空振りしていない（漏れていた Blob の項目を確かに拾っている）', () => {
    const blob = fs.readFileSync(
      path.join(src, 'blob/blob.resolver.ts'),
      'utf-8',
    );
    const names = handlers(blob).map((h) => h.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'listBlobs',
        'setBlob',
        'deleteBlob',
        'releaseDeletedBlobs',
      ]),
    );
  });
});

/**
 * #285: REST も同じ。漏れの1つは `PUT /api/workspaces/:workspaceId/blobs/:key` だった。
 * ルートに `:workspaceId` を含むハンドラは `@WorkspaceRole` を持つか、許可リストに理由を書く。
 */
describe('ルートに :workspaceId を含む REST が認可を宣言している (#285)', () => {
  const src = path.join(__dirname, '../../../src/modules');

  const ALLOWED: Record<string, string> = {
    'GET /api/workspaces/:workspaceId/blobs/:key':
      '関数内で getMemberRole を確かめる（H-1 以前から）',
    'POST /api/workspaces/:workspaceId/export':
      '関数内で owner / Admin を確かめる（docs/doc-permission.md 6.5）',
  };

  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return files(p);
      return e.name.endsWith('.controller.ts') ? [p] : [];
    });

  /** `METHOD /path` と、そのハンドラに付いたデコレータ（ハンドラ単位） */
  const routes = (source: string) => {
    const prefix = /@Controller\('([^']*)'\)/.exec(source)?.[1] ?? '';
    const classGuarded =
      /@UseGuards\([^)]*WorkspaceMemberGuard[^)]*\)\s*export class/.test(
        source,
      );
    const out: Array<{ route: string; decorators: string; guarded: boolean }> =
      [];
    const re = /((?:\s*@\w+\((?:[^()]|\([^()]*\))*\)\s*)+)\s*async \w+\(/g;
    for (const m of source.matchAll(re)) {
      const decorators = m[1];
      const http = /@(Get|Post|Put|Patch|Delete)\('([^']*)'\)/.exec(decorators);
      if (!http) continue;
      const route = `${http[1].toUpperCase()} /${[prefix, http[2]].filter(Boolean).join('/')}`;
      const guarded =
        classGuarded ||
        /@UseGuards\([^)]*WorkspaceMemberGuard/.test(decorators);
      out.push({ route, decorators, guarded });
    }
    return out;
  };

  const all = () =>
    files(src).flatMap((f) => routes(fs.readFileSync(f, 'utf-8')));

  it('@WorkspaceRole が付いているか、許可リストに理由がある', () => {
    const missing = all()
      .filter((r) => r.route.includes(':workspaceId'))
      .filter((r) => !ALLOWED[r.route])
      .filter((r) => !(r.guarded && /@WorkspaceRole\(/.test(r.decorators)))
      .map((r) => r.route);
    expect({
      認可の無い経路: missing.sort(),
      対処: '@UseGuards(WorkspaceMemberGuard) と @WorkspaceRole(...) を付けるか、ALLOWED に理由を書く',
    }).toEqual({ 認可の無い経路: [], 対処: expect.any(String) });
  });

  it('⚠️ 検査が空振りしていない・許可リストに実在しない経路が残っていない', () => {
    const found = new Set(all().map((r) => r.route));
    expect(found.has('PUT /api/workspaces/:workspaceId/blobs/:key')).toBe(true);
    expect(Object.keys(ALLOWED).filter((k) => !found.has(k))).toEqual([]);
  });
});
