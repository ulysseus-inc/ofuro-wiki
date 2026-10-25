/**
 * AI エージェント用 CLI（#265）。
 *
 * CLI はブラウザと同じ同期プロトコルでページを読み書きする。
 * ここでは「CLI が書いたものを人がブラウザで続けて使えるか」を見る。
 *
 * | 見ること | 設計書 |
 * |---|---|
 * | CLI で作ったページがブラウザで開ける（ページ・エッジレス） | G3 |
 * | 開いているブラウザへ CLI の編集が即時に届き、人の編集と共存する | G3 / G5 |
 * | マルチカラム等を含むページを CLI で編集しても、それらが残る | G2 |
 *
 * 前提: CLI を事前にビルドしておく
 *   cd frontend && node packages/common/agent-cli/esbuild.config.js
 *
 * 実行方法:
 *   cd e2e && BASE_URL=http://localhost:8080 npx playwright test agent-cli.spec.ts
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { test, expect, type Page } from '@playwright/test';
import {
  TEST_USER,
  ensureTestUser,
  signIn,
  getOwnedWorkspaceId,
  dismissDevOverlay,
  graphqlQuery,
} from './helpers';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';
const CLI = path.resolve(__dirname, '../skills/ofuro-wiki-cli/scripts/ofuro.mjs');

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/** トークンのキャッシュを開発者の ~/.ofuro-wiki と混ぜない */
const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ofuro-cli-e2e-'));
let workspaceUrl = '';

test.beforeAll(async () => {
  expect(fs.existsSync(CLI), `CLI が未ビルド: ${CLI}`).toBe(true);
  await ensureTestUser('http://localhost:3010');
});

test.afterAll(() => {
  fs.rmSync(cliHome, { recursive: true, force: true });
});

/** CLI を実行して標準出力を返す。失敗したら標準エラーを付けて投げる */
function cli(args: string[], input?: string): string {
  try {
    return execFileSync('node', [CLI, ...args], {
      input,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: cliHome,
        // ワークスペースは設定しない。招待されたものを CLI が自動で使う（設計書 §4.2）
        OFURO_URL: BASE_URL,
        OFURO_EMAIL: TEST_USER.email,
        OFURO_PASSWORD: TEST_USER.password,
      },
    });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`ofuro ${args[0]} が失敗した: ${err.stderr ?? err.message}`);
  }
}

/** `{#ID} 本文` の行から、本文で ID を引く */
function blockId(readOutput: string, content: string): string {
  const line = readOutput.split('\n').find(l => l.endsWith(` ${content}`));
  const id = line?.match(/^\{#([^}]+)\}/)?.[1];
  if (!id) {
    throw new Error(`ブロックが見つからない: ${content}\n${readOutput}`);
  }
  return id;
}

function createPage(title: string, markdown: string): { docId: string; url: string } {
  const out = cli(['create', '--title', title, '--stdin'], markdown);
  const docId = out.match(/docId: (\S+)/)?.[1];
  if (!docId) {
    throw new Error(`docId が出ていない: ${out}`);
  }
  const url = out.match(/作成した: (\S+)/)?.[1];
  if (!url) {
    throw new Error(`URL が出ていない: ${out}`);
  }
  return { docId, url };
}

/** 編集画面のエラー表示（ページが開けない・描画に失敗した） */
async function expectNoEditorError(page: Page) {
  await expect(page.locator('text=/Page Not Found|ページが見つかりません|Something went wrong/i')).toHaveCount(0);
}

async function openSignedIn(page: Page) {
  await signIn(page);
  const ownedId = await getOwnedWorkspaceId(page);
  expect(ownedId).toBeTruthy();
  workspaceUrl = `${BASE_URL}/workspace/${ownedId}`;
}

test.describe('AI エージェント用 CLI', () => {
  test('CLI で作ったページを、ブラウザのページ・エッジレス両方で開ける', async ({ page }) => {
    await openSignedIn(page);
    const title = `CLI作成 ${Date.now()}`;
    const { url } = createPage(
      title,
      '# 見出し\n\n**太字**の段落\n\n- [ ] ToDo\n\n| 項目 | 値 |\n|---|---|\n| A | 1 |\n'
    );

    await page.goto(url);
    await dismissDevOverlay(page);
    // ⚠️ サインイン直後は初回の同期が遅く、本文が「読み込み中」のまま数十秒かかることがある。
    // 題はヘッダーにも（台帳から）出るため、題ではなく本文の表示を待つ
    await expect(page.locator('affine-paragraph', { hasText: '太字の段落' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    await expect(page.locator('affine-list', { hasText: 'ToDo' })).toBeVisible();
    await expect(page.locator('affine-table')).toBeVisible();
    await expectNoEditorError(page);

    // 一覧にも出る（台帳への登録が先に済んでいる）
    await page.goto(`${workspaceUrl}/all`);
    await expect(page.locator(`text=${title}`).first()).toBeVisible({ timeout: 30_000 });

    // エッジレスでも落ちない
    await page.goto(`${url}?mode=edgeless`);
    await dismissDevOverlay(page);
    await expect(page.locator('affine-edgeless-root, edgeless-editor').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('affine-edgeless-note', { hasText: '太字の段落' }).first()).toBeVisible();
    await expectNoEditorError(page);
  });

  test('開いているブラウザへ CLI の編集が届き、人の編集と両方残る', async ({ page }) => {
    await openSignedIn(page);
    const { docId, url } = createPage(`共同編集 ${Date.now()}`, 'AIが書く段落\n\n人が書く段落\n');

    await page.goto(url);
    await dismissDevOverlay(page);
    const human = page.locator('affine-paragraph', { hasText: '人が書く段落' });
    await expect(human).toBeVisible({ timeout: 30_000 });

    // 人が打っている最中に、AI が別のブロックを書き換える
    await human.locator('.inline-editor').click();
    await page.keyboard.press('End');
    await page.keyboard.type('（人の追記）', { delay: 30 });

    const before = cli(['read', docId]);
    const target = blockId(before, 'AIが書く段落');
    cli([
      'edit',
      docId,
      '--ops',
      JSON.stringify([
        { op: 'replace', block: target, expect: 'AIが書く段落', content: 'AIが**書き換えた**段落' },
        { op: 'insert', after: target, content: '* AIが足した項目' },
      ]),
    ]);

    // 再読み込みせずに届く
    await expect(page.locator('affine-paragraph', { hasText: 'AIが書き換えた段落' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('affine-list', { hasText: 'AIが足した項目' })).toBeVisible();
    await expect(page.locator('affine-paragraph', { hasText: '人が書く段落（人の追記）' })).toBeVisible();

    // サーバー側にも両方が残っている
    await expect.poll(() => cli(['read', docId]), { timeout: 15_000 }).toContain('人が書く段落（人の追記）');
    const after = cli(['read', docId]);
    expect(after).toContain('AIが**書き換えた**段落');
    expect(after).toContain('* AIが足した項目');
  });

  test('マルチカラムの中を CLI で編集でき、開いているブラウザに届き、レイアウトが崩れない（#272）', async ({ page }) => {
    await openSignedIn(page);
    const { docId, url } = createPage(`カラム ${Date.now()}`, '先頭の段落\n\n末尾の段落\n');

    await page.goto(url);
    await dismissDevOverlay(page);
    const first = page.locator('affine-paragraph', { hasText: '先頭の段落' });
    await expect(first).toBeVisible({ timeout: 30_000 });

    // 人がブラウザでマルチカラムを入れ、中に書く
    await first.locator('.inline-editor').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('/');
    await page.waitForTimeout(1_000);
    await page.keyboard.press('2');
    await page.waitForTimeout(500);
    await page.locator('text=2列のレイアウトを作成します').first().click();
    const cells = page.locator('affine-column-cell');
    await expect(cells).toHaveCount(2, { timeout: 10_000 });
    await cells.nth(0).locator('.inline-editor').first().click();
    await page.keyboard.type('カラムの中身', { delay: 30 });

    await expect.poll(() => cli(['read', docId]), { timeout: 15_000 }).toContain('[columns 編集不可]');

    // カラムの構造は触れない。中身は外と同じく編集できる（#272）
    const read = cli(['read', docId]);
    const columnsId = read.match(/^\{#([^}]+)\} \[columns 編集不可\]/m)?.[1] as string;
    const cellIds = [...read.matchAll(/^\{#([^}]+)\} +\[column-cell 編集不可\]/gm)].map(m => m[1]);
    expect(cellIds).toHaveLength(2);
    expect(() =>
      cli(['edit', docId, '--ops', JSON.stringify([{ op: 'delete', block: columnsId, expect: '[columns 編集不可]' }])])
    ).toThrow(/編集できない/);

    const inner = blockId(read, 'カラムの中身');
    cli([
      'edit',
      docId,
      '--ops',
      JSON.stringify([
        { op: 'replace', block: inner, expect: 'カラムの中身', content: 'カラムの中身をAIが直した' },
        { op: 'insert', parent: cellIds[1], content: 'AIが右の列に足した' },
      ]),
    ]);
    await expect(cells.nth(0)).toContainText('カラムの中身をAIが直した', { timeout: 15_000 });
    await expect(cells.nth(1)).toContainText('AIが右の列に足した');

    // 前後の段落を CLI で編集する
    const tail = blockId(read, '末尾の段落');
    cli([
      'edit',
      docId,
      '--ops',
      JSON.stringify([
        { op: 'replace', block: tail, expect: '末尾の段落', content: '末尾をAIが変えた' },
        { op: 'insert', after: blockId(read, '先頭の段落'), content: 'AIの挿入' },
      ]),
    ]);

    await expect(page.locator('affine-paragraph', { hasText: '末尾をAIが変えた' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('affine-columns')).toBeVisible();
    await expect(cells).toHaveCount(2);
    await expect(cells.nth(0)).toContainText('カラムの中身をAIが直した');
    await expectNoEditorError(page);

    // 再読み込みしても残る（サーバーに保存されている）
    await page.reload();
    await dismissDevOverlay(page);
    await expect(page.locator('affine-columns')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('affine-column-cell')).toHaveCount(2);
    await expect(page.locator('affine-column-cell').nth(0)).toContainText('カラムの中身をAIが直した');
    await expect(page.locator('affine-column-cell').nth(1)).toContainText('AIが右の列に足した');
    await expect(page.locator('affine-paragraph', { hasText: 'AIの挿入' })).toBeVisible();
  });

  test('ゴミ箱・復元・完全削除がブラウザの一覧と揃う', async ({ page }) => {
    await openSignedIn(page);
    const title = `削除 ${Date.now()}`;
    const { docId } = createPage(title, '消される段落\n');

    // 題の変更は一覧（台帳）と本文の両方に入る
    const renamed = `${title} 改`;
    cli(['edit', docId, '--ops', JSON.stringify([{ op: 'title', text: renamed, expect: title }])]);
    expect(cli(['list'])).toContain(renamed);
    expect(cli(['read', docId])).toContain(`title: ${renamed}`);

    // ゴミ箱のページは検索・編集の対象にしない
    cli(['trash', docId]);
    expect(() =>
      cli(['edit', docId, '--ops', JSON.stringify([{ op: 'insert', content: 'x' }])])
    ).toThrow(/ゴミ箱にあるページは編集できない/);
    cli(['restore', docId]);

    expect(() => cli(['purge', docId, '--permanent'])).toThrow(/ゴミ箱に無い/);
    cli(['trash', docId]);
    expect(cli(['list'])).not.toContain(docId);
    cli(['restore', docId]);
    expect(cli(['list'])).toContain(docId);

    cli(['trash', docId]);
    cli(['purge', docId, '--permanent']);
    expect(() => cli(['read', docId])).toThrow(/存在しないか権限が無い/);

    await page.goto(`${workspaceUrl}/all`);
    await dismissDevOverlay(page);
    await page.waitForTimeout(3_000);
    await expect(page.locator(`text=${title}`)).toHaveCount(0);
    await expect(page.locator(`text=${renamed}`)).toHaveCount(0);
  });

  test('表の途中に行を足しても、ブラウザの並びと read・行番号が一致する（#279）', async ({ page }) => {
    await openSignedIn(page);
    const { docId, url } = createPage(
      `表の並び ${Date.now()}`,
      '| 物 |\n|---|\n| A |\n| B |\n| C |\n| D |\n'
    );
    const table = cli(['read', docId]).match(/\{#([^}]+)\} \|/)?.[1] as string;

    // Issue の手順: 3行目に X、4行目に Y、さらに途中へ何度か
    for (const [at, label] of [[3, 'X'], [4, 'Y'], [1, 'P'], [2, 'Q']] as const) {
      cli(['edit', docId, '--ops', JSON.stringify([{ op: 'table.insertRow', block: table, at, cells: [label] }])]);
    }

    // read の並び（見出しを除く）
    const readOrder = cli(['read', docId])
      .split('\n')
      .filter(l => /^\s*(\{#[^}]+\} )?\|/.test(l))
      .map(l => l.split('|')[1].trim())
      .filter(c => c && !/^-+$/.test(c))
      .slice(1);

    // ブラウザの並び
    await page.goto(url);
    await dismissDevOverlay(page);
    const rows = page.locator('affine-table tr[data-row-id]');
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });
    const browserOrder = (await rows.allInnerTexts()).map(t => t.trim()).slice(1);
    expect(browserOrder).toEqual(readOrder);

    // read の N 行目を、そのまま table.set の row に使える
    for (const [i, label] of readOrder.entries()) {
      cli(['edit', docId, '--ops', JSON.stringify([{ op: 'table.set', block: table, row: i + 1, col: 0, expect: label, text: label }])]);
    }
  });

  test('先頭の # 見出しを題にして、本文で二重にしない（#277）', async ({ page }) => {
    await openSignedIn(page);
    const title = `見出し題 ${Date.now()}`;
    const out = cli(['create', '--stdin'], `# ${title}\n\n本文の段落\n`);
    const docId = out.match(/docId: (\S+)/)?.[1] as string;
    const read = cli(['read', docId]);
    expect(read).toContain(`title: ${title}`);
    expect(read).not.toContain(`# ${title}`);
    expect(cli(['list'])).toContain(title);
  });

  test('Markdown から変えたブロックだけを更新し、dry-run 後の人の編集を検知する（#275）', async ({ page }) => {
    await openSignedIn(page);
    const base = '残す段落\n\n直す段落\n\n* 親\n  * 子\n\n| 項目 | 値 |\n|---|---|\n| A | 1 |\n| B | 2 |\n\n人が触る段落\n';
    const { docId, url } = createPage(`差分更新 ${Date.now()}`, base);
    const before = cli(['read', docId]);
    const kept = ['残す段落', '* 親', '* 子', '人が触る段落'].map(c => blockId(before, c));
    const fixed = blockId(before, '直す段落');
    const table = before.match(/^\{#([^}]+)\} \| 項目/m)?.[1] as string;

    const next = base.replace('直す段落', '直した**段落**').replace('| B | 2 |', '| B | 20 |\n| C | 3 |') + '\n足した段落\n';
    const dryRun = cli(['update', docId, '--stdin', '--dry-run'], next);
    expect(dryRun).toContain('dry-run');
    expect(dryRun).toContain('+ ');
    const version = dryRun.match(/base: (\w+)/)?.[1] as string;
    expect(version).toBeTruthy();

    // dry-run の後に書き換えた Markdown は、同じ base では送れない
    expect(() => cli(['update', docId, '--stdin', '--base', version], `${next}\n承認していない段落\n`)).toThrow(/dry-run の後に/);

    // --base が無ければ送らない
    expect(() => cli(['update', docId, '--stdin'], next)).toThrow(/--base/);

    // dry-run の後に人が編集したら、送らずに止まる
    await page.goto(url);
    await dismissDevOverlay(page);
    const human = page.locator('affine-paragraph', { hasText: '人が触る段落' });
    await expect(human).toBeVisible({ timeout: 60_000 });
    await human.locator('.inline-editor').click();
    await page.keyboard.press('End');
    await page.keyboard.type('（人）', { delay: 30 });
    await expect.poll(() => cli(['read', docId]), { timeout: 15_000 }).toContain('人が触る段落（人）');
    expect(() => cli(['update', docId, '--stdin', '--base', version], next)).toThrow(/dry-run の後に/);

    // 人の編集を取り込んだ Markdown で、dry-run からやり直す
    const merged = next.replace('人が触る段落', '人が触る段落（人）');
    const again = cli(['update', docId, '--stdin', '--dry-run'], merged);
    const version2 = again.match(/base: (\w+)/)?.[1] as string;
    expect(cli(['update', docId, '--stdin', '--base', version2], merged)).toContain('更新した');

    // 開いているブラウザへ届く
    await expect(page.locator('affine-paragraph', { hasText: '直した段落' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('affine-paragraph', { hasText: '足した段落' })).toBeVisible();
    await expect(page.locator('affine-table')).toContainText('20');

    // 変えていないブロック・直した段落・表は ID が残る。もう一度当てると差が無い
    const after = cli(['read', docId]);
    for (const id of [...kept, fixed, table]) {
      expect(after).toContain(`{#${id}}`);
    }
    expect(after).toContain('直した**段落**');
    expect(after).toMatch(/\| C +\| 3 +\|/);
    expect(cli(['update', docId, '--stdin', '--dry-run'], merged)).toMatch(/^変更なし/);
    await expectNoEditorError(page);
  });

  test('タグを作って付け外しでき、ブラウザのタグの画面と揃う（#276）', async ({ page }) => {
    await openSignedIn(page);
    const stamp = Date.now();
    const first = `E2Eタグ${stamp}`;
    const second = `E2E別タグ${stamp}`;
    const title = `タグ付き ${stamp}`;

    // 無い名前は作って付ける（ブラウザの入力欄と同じ）
    const out = cli(['create', '--title', title, '--stdin', '--tag', first], '本文\n');
    expect(out).toContain(`新しいタグを作った: ${first}`);
    const docId = out.match(/docId: (\S+)/)?.[1] as string;
    expect(cli(['read', docId])).toContain(`tags: ${first}`);

    const listed = JSON.parse(cli(['tags', '--json'])) as Array<{ id: string; name: string; pages: number }>;
    const created = listed.find(t => t.name === first);
    expect(created?.pages).toBe(1);

    // ブラウザも CLI が作ったタグの定義と、台帳のタグを読める
    await page.goto(`${workspaceUrl}/tag/${created?.id}`);
    await dismissDevOverlay(page);
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 60_000 });

    // 付け外し。無い名前の --remove は拒む
    expect(() => cli(['tag', docId, '--remove', `無い${stamp}`])).toThrow(/タグが無い/);
    const changed = cli(['tag', docId, '--add', second, '--remove', first]);
    expect(changed).toContain(`タグ: ${second}`);
    expect(changed).toContain(`新しいタグを作った: ${second}`);

    // 絞り込み
    expect(cli(['list', '--tag', second])).toContain(docId);
    expect(cli(['list', '--tag', first])).not.toContain(docId);
    expect(() => cli(['list', '--tag', `無い${stamp}`])).toThrow(/タグが無い/);

    // 外したタグの画面からは消える
    await page.reload();
    await expect(page.getByText(title)).toHaveCount(0, { timeout: 30_000 });
    await expectNoEditorError(page);
  });

  test('フォルダを作ってページを出し入れでき、ブラウザのサイドバーと揃う（#274）', async ({ page }) => {
    await openSignedIn(page);
    const stamp = Date.now();
    const parent = `E2E親${stamp}`;
    const child = `E2E子${stamp}`;
    const title = `フォルダ入り ${stamp}`;

    expect(cli(['folder', 'create', parent])).toContain(`フォルダを作った: ${parent}`);
    expect(cli(['folder', 'create', child, '--parent', parent])).toContain(`${parent} / ${child}`);

    const out = cli(['create', '--title', title, '--stdin', '--folder', child], '本文\n');
    expect(out).toContain(`フォルダ: ${parent} / ${child}`);
    const docId = out.match(/docId: (\S+)/)?.[1] as string;

    // 1ページを複数のフォルダに入れられる
    expect(cli(['folder', 'add', parent, docId])).toContain('フォルダに入れた');
    expect(cli(['folder', 'add', parent, docId])).toContain('既に入っている');
    const tree = JSON.parse(cli(['folders', '--json'])) as Array<{ folders: Array<{ name: string; pages: Array<{ docId: string }>; folders: Array<{ name: string; pages: Array<{ docId: string }> }> }> }>;
    const top = tree.flatMap(t => t.folders).find(f => f.name === parent);
    expect(top?.pages.map(p => p.docId)).toEqual([docId]);
    expect(top?.folders.find(f => f.name === child)?.pages.map(p => p.docId)).toEqual([docId]);

    // ブラウザのサイドバーにも出る（親を開くと子フォルダとページ）
    await page.goto(`${workspaceUrl}/all`);
    await dismissDevOverlay(page);
    const sidebarParent = page.getByText(parent, { exact: true }).first();
    await expect(sidebarParent).toBeVisible({ timeout: 60_000 });
    await sidebarParent.click();
    await expect(page.getByText(child, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();

    // 外してもページは消えない。絞り込みも揃う
    expect(cli(['folder', 'remove', child, docId])).toContain('フォルダから外した');
    expect(cli(['list', '--folder', child])).not.toContain(docId);
    expect(cli(['list', '--folder', parent])).toContain(docId);
    expect(cli(['read', docId])).toContain(`title: ${title}`);
    expect(() => cli(['list', '--folder', `無い${stamp}`])).toThrow(/フォルダが無い/);
    await expectNoEditorError(page);
  });

  test('ブラウザで貼った画像を CLI で取り出すと、同じバイト列になる（#273）', async ({ page }) => {
    await openSignedIn(page);
    // 4×4 の赤い PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP4z8AARwzEcQCukw/x0F8jngAAAABJRU5ErkJggg==',
      'base64'
    );
    const { docId, url } = createPage(`画像取り出し ${Date.now()}`, '画像の前の段落\n');

    // 人がスラッシュメニューから画像を貼る
    await page.goto(url);
    await dismissDevOverlay(page);
    const paragraph = page.locator('affine-paragraph', { hasText: '画像の前の段落' });
    await expect(paragraph).toBeVisible({ timeout: 60_000 });
    await paragraph.locator('.inline-editor').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('/');
    const imageItem = page.locator('text=画像を挿入する。').first();
    await expect(imageItem).toBeVisible({ timeout: 5_000 });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), imageItem.click()]);
    await chooser.setFiles({ name: 'e2e-agent-image.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('img[src^="blob:"], img[src^="data:"]').first()).toBeVisible({ timeout: 30_000 });

    // サーバーに届いた（read --json に鍵が出た）ら取り出す
    type Block = { id: string; flavour: string; asset?: { sourceId?: string } };
    let imageBlock: Block | undefined;
    await expect
      .poll(
        () => {
          const blocks = (JSON.parse(cli(['read', docId, '--json'])) as { blocks: Block[] }).blocks;
          imageBlock = blocks.find(b => b.flavour === 'affine:image' && b.asset?.sourceId);
          return Boolean(imageBlock);
        },
        { timeout: 30_000 }
      )
      .toBe(true);

    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ofuro-e2e-image-'));
    try {
      // 画像が届くのは本文の後のことがある。取れるまで待つ
      let saved = '';
      await expect
        .poll(
          () => {
            try {
              saved = cli(['image', 'get', docId, imageBlock!.id, '--out', out]).trim();
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 30_000 }
        )
        .toBe(true);
      expect(saved).toBe(path.join(out, `${imageBlock!.id}.png`));
      expect(fs.readFileSync(saved).equals(png)).toBe(true);

      // 画像でないブロックは拒む
      const read = cli(['read', docId]);
      expect(() => cli(['image', 'get', docId, blockId(read, '画像の前の段落'), '--out', out])).toThrow(/画像・添付ではない/);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('CLI で足した画像がブラウザに出て、取り出すと同じバイト列になる。Markdown の画像も作成・更新できる（#278）', async ({ page }) => {
    await openSignedIn(page);
    // 4×4 の赤い PNG・1×1 の GIF
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP4z8AARwzEcQCukw/x0F8jngAAAABJRU5ErkJggg==',
      'base64'
    );
    const gif = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ofuro-e2e-image-add-'));
    try {
      fs.writeFileSync(path.join(work, 'red.png'), png);
      fs.mkdirSync(path.join(work, 'img'));
      fs.writeFileSync(path.join(work, 'img', 'dot.gif'), gif);

      // 1) image add: dry-run は送らず、送ると画像ブロックになる
      const { docId, url } = createPage(`画像追加 ${Date.now()}`, '画像の前\n\n画像の後\n');
      const anchorId = blockId(cli(['read', docId]), '画像の前');
      const file = path.join(work, 'red.png');
      const dry = cli(['image', 'add', docId, '--file', file, '--after', anchorId, '--caption', '赤い四角', '--dry-run']);
      expect(dry).toContain('画像: 1 件');
      expect(dry).toContain('+ ');
      expect(cli(['read', docId])).not.toContain('[image]');

      expect(cli(['image', 'add', docId, '--file', file, '--after', anchorId, '--caption', '赤い四角'])).toContain('更新した');
      const read = cli(['read', docId]);
      expect(read).toContain('[image] 赤い四角');
      const imageId = blockId(read, '[image] 赤い四角');

      // ブラウザに出る
      await page.goto(url);
      await dismissDevOverlay(page);
      await expect(page.locator('affine-image img, affine-page-image img').first()).toBeVisible({ timeout: 60_000 });
      await expectNoEditorError(page);

      // #273 の取り出しでバイト列が一致する
      const out = path.join(work, 'out');
      const saved = cli(['image', 'get', docId, imageId, '--out', out]).trim();
      expect(fs.readFileSync(saved).equals(png)).toBe(true);

      // 画像を消せる（expect は [image] キャプション）
      cli(['edit', docId, '--ops', JSON.stringify([{ op: 'delete', block: imageId, expect: '[image] 赤い四角' }])]);
      expect(cli(['read', docId])).not.toContain('[image]');

      // 2) Markdown の画像: 作成で画像ブロックになり、同じ Markdown の更新は差が無い
      const mdFile = path.join(work, 'doc.md');
      const md = `# Markdown画像 ${Date.now()}\n\n図の説明\n\n![図](./img/dot.gif)\n\n末尾\n`;
      fs.writeFileSync(mdFile, md);
      const created = cli(['create', '--file', mdFile]);
      const mdDoc = created.match(/docId: (\S+)/)?.[1] as string;
      const mdRead = cli(['read', mdDoc]);
      expect(mdRead).toMatch(/\[image\]/);
      expect(mdRead.split('\n').filter(l => /^\{#[^}]+\} *$/.test(l))).toEqual([]); // 空の段落を作らない
      expect(cli(['update', mdDoc, '--file', mdFile, '--dry-run'])).toMatch(/^変更なし/);
      const mdImage = (JSON.parse(cli(['read', mdDoc, '--json'])) as { blocks: Array<{ id: string; flavour: string }> }).blocks.find(
        b => b.flavour === 'affine:image'
      );
      const mdSaved = cli(['image', 'get', mdDoc, mdImage!.id, '--out', path.join(work, 'out2')]).trim();
      expect(fs.readFileSync(mdSaved).equals(gif)).toBe(true);

      // 3) 画像でないファイル・外部 URL は拒む
      fs.writeFileSync(path.join(work, 'fake.png'), 'not an image');
      expect(() => cli(['image', 'add', docId, '--file', path.join(work, 'fake.png')])).toThrow(/画像として読めない/);
      expect(() => cli(['edit', docId, '--ops', JSON.stringify([{ op: 'insert', content: '![x](https://example.com/a.png)' }])])).toThrow();
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  test('検索でヒットする（searchDocs の抜粋が文字列で返る）', async ({ page }) => {
    await openSignedIn(page);
    const word = `検索語${Date.now()}`;
    const { docId } = createPage(`検索 ${word}`, `${word} を含む段落\n`);

    // 索引はサーバー側で遅れて作られる
    await expect.poll(() => cli(['search', word]), { timeout: 30_000 }).toContain(docId);
  });

  test('複数のワークスペースでは、作成先だけを選ばせ、他は自動で探す', async ({ page }) => {
    await openSignedIn(page);

    // 2つ目のワークスペースに招待された状態を作る
    const created = await graphqlQuery(
      page,
      'mutation { createWorkspace(name: "E2E第二") { id } }'
    );
    const secondId: string = created.data.createWorkspace.id;

    try {
      // 作成先が決まらないときは、候補を示して選ばせる
      expect(() => cli(['create', '--title', '迷子', '--stdin'], 'x\n')).toThrow(
        /作成先のワークスペースを --workspace で指定する（候補: .*E2E第二/
      );

      // 名前で選べる
      const title = `第二 ${Date.now()}`;
      const out = cli(['create', '--title', title, '--stdin', '--workspace', 'E2E第二'], '第二の本文\n');
      expect(out).toContain(`/workspace/${secondId}/`);
      const docId = out.match(/docId: (\S+)/)?.[1] as string;

      // docId だけで、どのワークスペースにあるかを CLI が探す
      expect(cli(['read', docId])).toContain('第二の本文');

      // 一覧は全ワークスペースをまとめ、各行にワークスペース名を付ける
      const line = cli(['list']).split('\n').find(l => l.includes(docId));
      expect(line?.startsWith('E2E第二\t')).toBe(true);

      // 絞り込みもできる
      expect(cli(['list', '--workspace', 'E2E第二'])).toContain(docId);
      expect(cli(['list', '--workspace', 'E2E第二'])).not.toContain('E2E第二\t');
    } finally {
      await graphqlQuery(page, `mutation { deleteWorkspace(id: "${secondId}") }`);
    }
  });
});
