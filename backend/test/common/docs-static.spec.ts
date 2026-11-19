import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { staticImports } from '../../src/common/static-files';

/**
 * #324: ガイドを本体が /docs/ で配る（docs/docs-site.md 5.1）。
 *
 * ```
 * /docs/*  → ガイド（VitePress のビルド結果）。無いページは 404（画面に落とさない）
 * それ以外 → 画面（SPA。無いパスは index.html）
 * ```
 */
describe('ガイドの配信 /docs/ (#324)', () => {
  let root: string;
  let app: INestApplication;

  const SPA = '<html>spa</html>';
  const DOCS_TOP = '<html>docs top</html>';
  const DOCS_PAGE = '<html>docs install</html>';
  const SECRET = 'top-secret-value';

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'docs-static-'));

    const frontend = join(root, 'public');
    mkdirSync(frontend);
    writeFileSync(join(frontend, 'index.html'), SPA);

    // VitePress（cleanUrls）の出力: /guide/install-server → guide/install-server.html
    const docs = join(root, 'public-docs');
    mkdirSync(join(docs, 'guide'), { recursive: true });
    writeFileSync(join(docs, 'index.html'), DOCS_TOP);
    writeFileSync(join(docs, 'guide', 'install-server.html'), DOCS_PAGE);
    writeFileSync(join(docs, '404.html'), '<html>docs 404</html>');
    // ガイドの外（1 つ上）に置く。/docs/ から読めてはいけない
    writeFileSync(join(root, 'secret.txt'), SECRET);

    // Test.createTestingModule は HTTP アダプタの前に作るため、配信が空（NoopLoader）になる。本物と同じく NestFactory で作る
    @Module({
      imports: staticImports({ frontend, docs, mobile: join(root, 'no-mobile') }),
    })
    class StaticOnly {}
    app = await NestFactory.create(StaticOnly, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('/docs/ はガイドのトップ', async () => {
    const res = await request(app.getHttpServer()).get('/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toBe(DOCS_TOP);
  });

  it('拡張子なしの URL でページが開く（cleanUrls）', async () => {
    const res = await request(app.getHttpServer()).get('/docs/guide/install-server');
    expect(res.status).toBe(200);
    expect(res.text).toBe(DOCS_PAGE);
  });

  it('【重要】ガイドに無いページは 404。画面（SPA）を返さない', async () => {
    const res = await request(app.getHttpServer()).get('/docs/guide/nothing');
    expect(res.status).toBe(404);
    expect(res.text).not.toBe(SPA);
  });

  it('【重要】ガイドの外のファイルは読めない（.. で上の階層へ出られない）', async () => {
    // ガイドのフォルダの 1 つ上に置いた秘密のファイルを、エンコードした .. で取りに行く
    for (const path of [
      '/docs/%2e%2e/secret.txt',
      '/docs/%2e%2e%2fsecret.txt',
      '/docs/..%2fsecret.txt',
      '/docs/%252e%252e/secret.txt',
      '/docs/guide/%2e%2e/%2e%2e/secret.txt',
    ]) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.text).not.toContain(SECRET);
    }
  });

  it('/docs で始まるだけのパス（/docs-foo）は、ガイドでなく画面（SPA）', async () => {
    const res = await request(app.getHttpServer()).get('/docs-foo');
    expect(res.status).toBe(200);
    expect(res.text).toBe(SPA);
  });

  it('ガイド以外は今までどおり画面（SPA）', async () => {
    const res = await request(app.getHttpServer()).get('/workspace/abc/doc1');
    expect(res.status).toBe(200);
    expect(res.text).toBe(SPA);
  });
});
