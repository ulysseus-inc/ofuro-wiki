// ⚠️ jest は .mjs を読めない（transform が .ts/.js だけ）。既存の spec と同じく差し替える。
// ただし**本物と同じ名前・説明の scalar にすること**。{} にすると SDL が変わり、
// 「スキーマが古い」と誤って落ちる（graphql-upload/GraphQLUpload.mjs の定義を写した）
jest.mock('graphql-upload/GraphQLUpload.mjs', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GraphQLScalarType } = require('graphql');
  return {
    __esModule: true,
    default: new GraphQLScalarType({
      name: 'Upload',
      description: 'The `Upload` scalar type represents a file upload.',
    }),
  };
});

import { readFileSync } from 'fs';
import { buildSchema, lexicographicSortSchema, printSchema } from 'graphql';
import { join } from 'path';
import {
  buildSchemaSdl,
  collectResolvers,
  findResolverFiles,
  SCHEMA_PATH,
} from '../../src/scripts/print-schema';

/**
 * #205: **書き出し済みの `schema.gql` が、いまのリゾルバと一致していること。**
 *
 * ⚠️ ここで守っているのは、**ずれても誰も気づかない**性質のもの。
 *
 * フロントエンドの codegen は `backend/schema.gql` を読む。リゾルバを変えて
 * このファイルを更新し忘れると、codegen は**古いスキーマ**で型を作り、
 * 「実装に無いフィールドを送る」形の不具合（#131）がまた型検査を素通りする。
 *
 * ⚠️ DB もサーバーの起動も要らない（CI でそのまま走る）。
 *
 * 落ちたら: backend で `npm run schema:gql` を実行して、`schema.gql` をコミットする。
 */
describe('GraphQL スキーマの書き出し（#205）', () => {
  // リゾルバを全部読み込んでスキーマを組むので、少し時間がかかる
  jest.setTimeout(60_000);

  test('⚠️ schema.gql が、いまのリゾルバから組んだスキーマと一致する', async () => {
    const { sdl } = await buildSchemaSdl();
    const committed = readFileSync(SCHEMA_PATH, 'utf8');

    // 一致しないときは差分の要約を出す（全文だと読めない）
    if (sdl !== committed) {
      const want = new Set(sdl.split('\n'));
      const have = new Set(committed.split('\n'));
      const missing = [...want].filter((l) => !have.has(l)).slice(0, 10);
      const extra = [...have].filter((l) => !want.has(l)).slice(0, 10);
      throw new Error(
        'backend/schema.gql is out of date. Run `npm run schema:gql` in backend.\n' +
          `missing from file:\n  ${missing.join('\n  ')}\n` +
          `only in file:\n  ${extra.join('\n  ')}`,
      );
    }
  });

  /**
   * ⚠️ **リゾルバを取りこぼさないこと。** 取りこぼすと、そのリゾルバの
   * クエリがスキーマから消え、上のテストも「一致」してしまう
   * （ファイルごと取りこぼした状態で書き出されるため）。
   *
   * 実際に、判定のメタデータを取り違えて **15個中5個しか拾えなかった**
   * （`graphql:resolver_type` は `@Resolver(() => X)` のときだけ付く）。
   */
  test('⚠️ *.resolver.ts のクラスを1つも取りこぼさない', () => {
    const files = findResolverFiles(join(__dirname, '..', '..', 'src', 'modules'));
    const resolvers = collectResolvers(files);

    // どのファイルからも最低1つはリゾルバが拾えること
    const namesByFile = files.map((file) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(file) as Record<string, unknown>;
      return Object.values(mod).filter(
        (v) => typeof v === 'function' && resolvers.includes(v),
      ).length;
    });

    expect(files.length).toBeGreaterThan(0);
    expect(namesByFile.every((n) => n > 0)).toBe(true);
  });

  /**
   * サーバーは `sortSchema: true`（app.module.ts）で、中身は graphql の
   * `lexicographicSortSchema`。**並べ直しても変わらない**ことで同じ順だと確かめる。
   *
   * ⚠️ 並び順を自前で再現しないこと。graphql は大文字を小文字より先に並べる
   * （`BlobUploadInit` < `BlobUploadedPart`）。`localeCompare` で比べて誤って落ちた
   */
  test('サーバー（app.module.ts）と同じく、並び順を揃えて書き出す', async () => {
    const { sdl } = await buildSchemaSdl();
    const resorted = `${printSchema(lexicographicSortSchema(buildSchema(sdl)))}\n`;
    expect(resorted).toBe(sdl);
  });
});
