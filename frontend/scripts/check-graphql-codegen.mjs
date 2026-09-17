#!/usr/bin/env node
/**
 * #207: 送るクエリ（`index.ts`）と型（`schema.ts`・#210）が、生成したものと**一致するか**を検査する。
 *
 * ## 何を捕まえるか
 *
 * GraphQL の定義は文字列として送られ、型検査でもバックエンドのスキーマとは
 * 突き合わされない。**実際に投げるまで間違いに気づかない**（#131。ページの公開は
 * 共有メニューから押せるのに必ず失敗していた）。
 *
 * | 場面 | どこで落ちるか |
 * |---|---|
 * | `.gql` がバックエンドのスキーマと合わない | codegen が異常終了する |
 * | `index.ts` / `schema.ts` を手で書き換えた | 再生成で消える → 差分 |
 * | バックエンドを変えて `schema.ts` を再生成し忘れた | 再生成で変わる → 差分 |
 * | `.gql` を直して再生成し忘れた | 再生成で変わる → 差分 |
 *
 * ## 使い方
 *
 *   yarn graphql:check
 *
 * 落ちたら: `packages/common/graphql` で `yarn build` を実行し、`index.ts` と `schema.ts` をコミットする。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

/** 生成物（frontend からの相対パス）。コミット済みのものと違ったら失敗させる */
const GENERATED_FILES = [
  'packages/common/graphql/src/graphql/index.ts',
  // #210: 型も生成物になった
  'packages/common/graphql/src/schema.ts',
];

/** `git status --porcelain` の結果（空なら変更なし） */
function gitStatus(...paths) {
  const result = spawnSync('git', ['status', '--porcelain', '--', ...paths], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.error || result.status !== 0) {
    console.error(`\n❌ git status を実行できませんでした: ${result.error?.message ?? result.stderr}\n`);
    process.exit(1);
  }
  return result.stdout.trim();
}

// ⚠️ **未コミットの変更があれば、消す前に止める。** 生成し直すと手書きの変更は
// 上書きされて消え、しかも「一致」と判定される（2026-09-12 実測）。
// CI は常にコミット済みの状態で走るので、ここで止まるのは手元だけ
const uncommitted = gitStatus(...GENERATED_FILES);
if (uncommitted !== '') {
  console.error(
    `${uncommitted}\n` +
      `\n❌ 生成物に未コミットの変更があります。\n` +
      `\n手で書き換えたなら元に戻し、定義は .gql に書いてください。\n` +
      `codegen で再生成したものなら、コミットしてから実行し直してください。\n`
  );
  process.exit(1);
}

// ⚠️ **生成の前に消す。** codegen が何も書かずに正常終了しても、ファイルが
// 消えたままになって必ず差分として出る（「差分なし」の緑に化けさせない）
for (const file of GENERATED_FILES) {
  rmSync(file, { force: true });
}

// codegen を実行する（パッケージの build ＝ gql-gen --errors-only）
const codegen = spawnSync('yarn', ['workspace', '@ofuro/graphql', 'build'], {
  encoding: 'utf8',
  shell: false,
});

if (codegen.error) {
  console.error(`\n❌ codegen を起動できませんでした: ${codegen.error.message}\n`);
  process.exit(1);
}

console.log(`${codegen.stdout ?? ''}${codegen.stderr ?? ''}`);

// ⚠️ **終了コードを見る。差分だけで判定しないこと。** スキーマに無いフィールドを
// 書くと codegen は終了コード1で止まり、index.ts を書き換えない（2026-09-12 実測）。
// 差分だけ見ると「差分なし」で緑になる
if (codegen.status !== 0) {
  console.error(
    `\n❌ codegen が失敗しました（終了コード: ${codegen.status}）。\n` +
      `\n.gql がバックエンドのスキーマ（backend/schema.gql）と合っていません。上の出力を確認してください。\n` +
      `バックエンドを変えたなら、backend で \`npm run schema:gql\` も実行してください。\n`
  );
  process.exit(1);
}

const missing = GENERATED_FILES.filter(file => !existsSync(file));
if (missing.length > 0) {
  console.error(
    `\n❌ codegen は正常終了しましたが、${missing.join(', ')} を書きませんでした。\n` +
      `codegen.yml か export-gql-plugin.cjs が実態と合っていません。\n`
  );
  process.exit(1);
}

// 生成し直したものが、コミット済みのものと違うか
// （同じ場所の .gql は見ない。未追跡の .gql を差分と誤認しないため）
const changed = gitStatus(...GENERATED_FILES);
if (changed !== '') {
  const diff = spawnSync('git', ['diff', '--', ...GENERATED_FILES], { encoding: 'utf8', shell: false });
  console.error(`${changed}\n${diff.stdout ?? ''}`);
  console.error(
    '\n❌ 生成物（index.ts / schema.ts）が、生成したものと一致しません。\n' +
      '\n手で書き換えたか、.gql やバックエンドのスキーマを直して再生成し忘れています。\n' +
      'packages/common/graphql で `yarn build` を実行して、index.ts と schema.ts をコミットしてください。\n'
  );
  process.exit(1);
}

console.log('✅ index.ts と schema.ts は、生成したものと一致しています。');
