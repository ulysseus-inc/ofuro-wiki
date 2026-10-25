import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

/**
 * CLI を1ファイルにまとめ、リポジトリ直下の Skill へ置く（設計書 §3.1）。
 *
 * ```
 * src/main.ts   ──▶ skills/ofuro-wiki-cli/scripts/ofuro.mjs
 * src/format.md ──▶ skills/ofuro-wiki-format/SKILL.md（ofuro help format と同じ内容）
 * __tests__/*   ──▶ dist-test/（--test のとき）
 * ```
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const skillsDir = path.join(repoRoot, 'skills');

/** ESM の束に CommonJS の依存（socket.io の ws 等）が require を使うため */
const REQUIRE_SHIM = [
  "import { createRequire as __createRequire } from 'node:module';",
  'const require = __createRequire(import.meta.url);',
].join('\n');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  loader: { '.md': 'text' },
  logLevel: 'error',
  banner: { js: REQUIRE_SHIM },
};

const FORMAT_FRONTMATTER = `---
name: ofuro-wiki-format
description: ofuro-wiki CLI（ofuro read / ofuro edit）の読取表現と編集操作 JSON の書式。ofuro edit の操作を組み立てる前に読む。
---

`;

async function buildCli() {
  await build({
    ...common,
    entryPoints: [path.join(here, 'src/main.ts')],
    outfile: path.join(skillsDir, 'ofuro-wiki-cli/scripts/ofuro.mjs'),
    minify: true,
    legalComments: 'eof',
    banner: { js: `#!/usr/bin/env node\n${REQUIRE_SHIM}` },
  });

  const format = await fs.readFile(path.join(here, 'src/format.md'), 'utf8');
  await fs.mkdir(path.join(skillsDir, 'ofuro-wiki-format'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(skillsDir, 'ofuro-wiki-format/SKILL.md'),
    FORMAT_FRONTMATTER + format
  );
}

async function buildTests() {
  const dir = path.join(here, '__tests__');
  const specs = (await fs.readdir(dir)).filter(f => f.endsWith('.spec.ts'));
  await fs.rm(path.join(here, 'dist-test'), { recursive: true, force: true });
  await build({
    ...common,
    entryPoints: specs.map(f => path.join(dir, f)),
    outdir: path.join(here, 'dist-test'),
    outExtension: { '.js': '.mjs' },
  });
}

if (process.argv.includes('--test')) {
  await buildTests();
} else {
  await buildCli();
}
