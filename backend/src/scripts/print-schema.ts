/**
 * GraphQL スキーマをファイルに書き出す（#205）。
 *
 * ⚠️ **DB もサーバーの起動も要らない。** リゾルバのクラスからスキーマを組み立てるだけ。
 * フロントエンドの codegen がこのファイルを読む。CI（DB が無い）でも回せる。
 *
 * ⚠️ **稼働中のサーバーと同じスキーマになること。** リゾルバを足したら
 * ここに自動で拾われる（`*.resolver.ts` を全部読む）。`sortSchema` も揃える。
 *
 * 使い方: npm run schema:gql
 */
import 'reflect-metadata';
import { ENTRY_PROVIDER_WATERMARK } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';
import {
  GraphQLSchemaBuilderModule,
  GraphQLSchemaFactory,
} from '@nestjs/graphql';
import { readdirSync, statSync, writeFileSync } from 'fs';
import { lexicographicSortSchema, printSchema } from 'graphql';
import { join, relative } from 'path';

/** スキーマの出力先。フロントエンドの codegen.yml がここを指す */
export const SCHEMA_PATH = join(__dirname, '..', '..', 'schema.gql');

/** `src/modules` 以下の `*.resolver.ts`（ビルド後は `.js`）を集める */
function findResolverFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files.push(...findResolverFiles(path));
      continue;
    }
    if (/\.resolver\.(ts|js)$/.test(name) && !name.endsWith('.d.ts')) {
      files.push(path);
    }
  }
  return files.sort();
}

/** 読み込んだモジュールのうち、`@Resolver()` が付いたクラスだけを取り出す */
function collectResolvers(files: string[]): Function[] {
  const resolvers: Function[] = [];
  for (const file of files) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      if (typeof value !== 'function') {
        continue;
      }
      // ⚠️ @Resolver() が必ず付けるのはこの印。'graphql:resolver_type' は
      // 引数付き（@Resolver(() => X)）のときだけで、それで判定すると
      // 15個中5個しか拾えなかった（2026-09-11 実測）
      if (!Reflect.getMetadata(ENTRY_PROVIDER_WATERMARK, value)) {
        continue;
      }
      resolvers.push(value);
    }
  }
  return resolvers;
}

/**
 * リゾルバから組み立てたスキーマを SDL（文字列）で返す。
 * ⚠️ ファイルには書かない。単体テストが「書き出し済みのファイルと一致するか」を見るのに使う
 */
export async function buildSchemaSdl(): Promise<{
  sdl: string;
  resolverCount: number;
  fileCount: number;
}> {
  const modulesDir = join(__dirname, '..', 'modules');
  const files = findResolverFiles(modulesDir);
  const resolvers = collectResolvers(files);

  const app = await NestFactory.create(GraphQLSchemaBuilderModule, {
    logger: false,
  });
  try {
    await app.init();
    const factory = app.get(GraphQLSchemaFactory);
    const schema = await factory.create(resolvers);
    // ⚠️ サーバー側は sortSchema: true（app.module.ts）。揃えないと差分が出る
    const sdl = `${printSchema(lexicographicSortSchema(schema))}\n`;
    return { sdl, resolverCount: resolvers.length, fileCount: files.length };
  } finally {
    await app.close();
  }
}

async function main() {
  const { sdl, resolverCount, fileCount } = await buildSchemaSdl();
  writeFileSync(SCHEMA_PATH, sdl);
  console.log(
    `Wrote ${relative(process.cwd(), SCHEMA_PATH)} ` +
      `(${resolverCount} resolvers from ${fileCount} files)`,
  );
}

// ⚠️ import されたときは走らせない（単体テストが読み込むため）
if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to print GraphQL schema', error);
    process.exit(1);
  });
}

export { collectResolvers, findResolverFiles };
