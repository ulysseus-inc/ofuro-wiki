/**
 * PR #267 のレビュー指摘の回帰テスト。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import * as Y from 'yjs';

import { Echo, cleanAnswer } from '../src/commands/login';
import { loadDoc, strict } from '../src/convert/blocksuite';
import { Editor, normalize } from '../src/domain/editor';
import { Ledger, TrashState, type LedgerDoc } from '../src/domain/ledger';
import { lineDiff } from '../src/domain/line-diff';
import { CliError } from '../src/errors';
import {
  Auth,
  cachedTokenFor,
  findCookie,
  signIn,
} from '../src/transport/auth';
import {
  ConfigSource,
  selectConfig,
  writePrivateFile,
} from '../src/transport/config';
import type { GraphqlClient } from '../src/transport/graphql';
import { buildFixture } from './fixture';

/** 古い AFFiNE のデータ。段落に `prop:type` が無く、note に props が無い */
function oldFormatState(): Uint8Array {
  const doc = new Y.Doc();
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  const add = (
    id: string,
    flavour: string,
    children: string[],
    props: Record<string, unknown>
  ) => {
    const block = new Y.Map<unknown>();
    blocks.set(id, block);
    block.set('sys:id', id);
    block.set('sys:flavour', flavour);
    block.set('sys:version', 1);
    const ys = new Y.Array<string>();
    ys.push(children);
    block.set('sys:children', ys);
    for (const [key, value] of Object.entries(props)) {
      block.set(key, value);
    }
  };
  add('p', 'affine:paragraph', [], { 'prop:text': new Y.Text('hello') });
  add('n', 'affine:note', ['p'], {});
  add('s', 'affine:surface', [], {});
  add('r', 'affine:page', ['s', 'n'], { 'prop:title': new Y.Text('t') });
  return Y.encodeStateAsUpdate(doc);
}

describe('送る差分（読み込み時の書き込み）', () => {
  it('⚠️ 読み込み時に blocksuite が補った値も送り、サーバー側で取り込める', () => {
    const state = oldFormatState();
    const loaded = loadDoc(`old-${Date.now()}`, state);
    const paragraph = loaded.store.getBlock('p')!.model as unknown as {
      props: { text: { insert(s: string, i: number): void } };
    };
    loaded.store.transact(() => paragraph.props.text.insert('!', 5));

    const update = loaded.takeUpdate();
    assert.ok(update);

    // サーバー＝読み込み前の状態にこの差分を足した Y.Doc
    const server = new Y.Doc();
    Y.applyUpdate(server, state);
    Y.applyUpdate(server, update);
    assert.equal(server.store.pendingStructs, null);
    const text = server
      .getMap<Y.Map<unknown>>('blocks')
      .get('p')!
      .get('prop:text');
    assert.equal(String(text), 'hello!');
  });

  it('⚠️ 削除だけの編集も送る（削除は state vector を進めない）', async () => {
    const { page, ids } = buildFixture();
    await new Editor(page).apply([
      { op: 'delete', block: ids.p2, expect: 'tail' },
    ]);
    assert.ok(page.doc.takeUpdate());
  });

  it('送った後は、同じ差分を二度送らない', () => {
    const loaded = loadDoc(`old2-${Date.now()}`, oldFormatState());
    loaded.takeUpdate();
    assert.equal(loaded.takeUpdate(), null);
  });
});

describe('Markdown 変換中の通信遮断', () => {
  it('⚠️ 表の行を足すとき（セルを並行に読む）、fetch と console を元に戻す', async () => {
    const { page, ids } = buildFixture();
    const { fetch: originalFetch, console: originalConsole } = globalThis;

    await new Editor(page).apply([
      { op: 'table.insertRow', block: ids.t1, cells: ['x', 'y'] },
    ]);

    assert.equal(globalThis.fetch, originalFetch);
    assert.equal(globalThis.console, originalConsole);
  });
});

describe('Ledger', () => {
  const doc: LedgerDoc = {
    id: 'd1',
    title: 't',
    trash: true,
    updatedAt: '',
    titleRevision: '1',
    trashRevision: '1',
    tagIds: [],
  };

  function ledgerReturning(data: unknown): {
    ledger: Ledger;
    calls: object[];
  } {
    const calls: object[] = [];
    const graphql = {
      request: (_query: string, variables: object) => {
        calls.push(variables);
        return Promise.resolve(data);
      },
    } as unknown as GraphqlClient;
    return { ledger: new Ledger(graphql, 'ws1'), calls };
  }

  it('⚠️ 完全削除がサーバーで成功しなければ、成功と報告しない', async () => {
    const { ledger } = ledgerReturning({
      deleteDocMeta: { status: 'not-found' },
    });
    await assert.rejects(ledger.purge('d1'), CliError);
  });

  it('ゴミ箱の操作は状態を enum で渡す', async () => {
    const { ledger, calls } = ledgerReturning({
      setDocTrash: { status: 'ok' },
    });
    await ledger.setTrash(doc, TrashState.Restored);
    assert.equal((calls[0] as { trash: boolean }).trash, false);
  });
});

describe('normalize（expect の比較を緩めすぎない）', () => {
  it('⚠️ 本文中の連続ハイフンの違いは見逃さない', () => {
    assert.notEqual(
      normalize('run with --force'),
      normalize('run with -force')
    );
  });

  it('⚠️ コード中の空行の違いは見逃さない', () => {
    assert.notEqual(normalize('```\na\n\nb\n```'), normalize('```\na\nb\n```'));
  });

  it('表の罫線の長さの違いは無視する', () => {
    assert.equal(
      normalize('| a |\n| --- |\n| 1 |'),
      normalize('| a |\n| - |\n| 1 |')
    );
  });
});

describe('lineDiff（大きなページ）', () => {
  it('⚠️ 5,000 行のページでも速く終わる', () => {
    const before = Array.from({ length: 5_000 }, (_, i) => `line ${i}`);
    const after = [...before];
    after[2_500] = 'changed';

    const started = Date.now();
    const diff = lineDiff(before, after);
    assert.ok(Date.now() - started < 1_000);
    assert.ok(diff.includes('- line 2500'));
    assert.ok(diff.includes('+ changed'));
  });
});

describe('login の入力', () => {
  it('⚠️ パスワードの前後の空白は削らない', () => {
    assert.equal(cleanAnswer('  pass  ', Echo.Hidden), '  pass  ');
    assert.equal(
      cleanAnswer('  user@example.com  ', Echo.Visible),
      'user@example.com'
    );
  });
});

describe('strict（Store.transact が握りつぶす例外の検出）', () => {
  /**
   * ⚠️ 検出は blocksuite の console.error の文言に頼っている。
   * blocksuite の更新で文言が変わると、途中で失敗した編集が成功として
   * 送られるようになる。その時はこのテストが落ちる。
   */
  it('⚠️ transact の中で起きた例外を CliError にする', async () => {
    const { page } = buildFixture();
    await assert.rejects(
      strict(() =>
        page.store.transact(() => {
          throw new Error('boom');
        })
      ),
      (e: unknown) => e instanceof CliError && /boom/.test(e.message)
    );
  });
});

describe('修正後のレビュー指摘', () => {
  const cached = {
    serverUrl: 'https://wiki.example.com',
    email: 'a@example.com',
    token: 't',
  };

  it('⚠️ メールが未設定なら、キャッシュのトークン（別人のものかもしれない）を使わない', () => {
    assert.equal(
      cachedTokenFor(cached, 'https://wiki.example.com', undefined),
      null
    );
  });

  it('サーバーとメールが一致すればキャッシュを使う', () => {
    assert.equal(
      cachedTokenFor(cached, 'https://wiki.example.com', 'a@example.com'),
      't'
    );
    assert.equal(
      cachedTokenFor(cached, 'https://wiki.example.com', 'b@example.com'),
      null
    );
    assert.equal(
      cachedTokenFor(cached, 'https://other.example.com', 'a@example.com'),
      null
    );
  });
});

describe('サインインの異常系', () => {
  async function withFetch<T>(
    response: Response,
    run: () => Promise<T>
  ): Promise<{ result?: T; error?: unknown; stderr: string }> {
    const original = globalThis.fetch;
    const originalWrite = process.stderr.write.bind(process.stderr);
    let stderr = '';
    globalThis.fetch = (() => Promise.resolve(response)) as typeof fetch;
    process.stderr.write = ((chunk: string) => {
      stderr += chunk;
      return true;
    }) as typeof process.stderr.write;
    try {
      return { result: await run(), stderr };
    } catch (error) {
      return { error, stderr };
    } finally {
      globalThis.fetch = original;
      process.stderr.write = originalWrite;
    }
  }

  it('⚠️ 壊れた Set-Cookie は CliError にする', () => {
    assert.throws(
      () => findCookie(['affine_token=%E0%A4%A; Path=/'], 'affine_token'),
      CliError
    );
  });

  it('429 は「試行が多すぎる」と返す', async () => {
    const { error } = await withFetch(new Response(null, { status: 429 }), () =>
      signIn('https://wiki.example.com', 'a@example.com', 'p')
    );
    assert.ok(
      error instanceof CliError && /試行が多すぎる/.test(error.message)
    );
  });

  it('⚠️ localhost 以外へ平文の HTTP でパスワードを送るときは警告する', async () => {
    const ok = new Response('{}', {
      status: 200,
      headers: { 'set-cookie': 'affine_token=t; Path=/' },
    });
    const { stderr } = await withFetch(ok, () =>
      signIn('http://wiki.example.com', 'a@example.com', 'p')
    );
    assert.match(stderr, /暗号化されていない/);
  });

  it('localhost の HTTP では警告しない', async () => {
    const ok = new Response('{}', {
      status: 200,
      headers: { 'set-cookie': 'affine_token=t; Path=/' },
    });
    const { stderr, result } = await withFetch(ok, () =>
      signIn('http://localhost:8080', 'a@example.com', 'p')
    );
    assert.equal(result, 't');
    assert.equal(stderr, '');
  });
});

describe('4回目のレビュー指摘', () => {
  it('⚠️ 既存ファイルが緩い権限でも、パスワードを緩いまま書かない（入れ替えで書く）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofuro-cli-test-'));
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, 'old', { mode: 0o644 });
    const inodeBefore = fs.statSync(file).ino;

    writePrivateFile(file, 'secret');

    const after = fs.statSync(file);
    assert.equal(fs.readFileSync(file, 'utf8'), 'secret');
    assert.equal(after.mode & 0o777, 0o600);
    // 同じファイルに上書きすると、書いてから絞るまでの間 0644 のまま中身が見える
    assert.notEqual(after.ino, inodeBefore);
    assert.deepEqual(fs.readdirSync(dir), ['config.json']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('⚠️ 別のプロセスが書いている最中の一時ファイルは消さない（並行実行）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofuro-cli-test-'));
    const file = path.join(dir, 'config.json');
    const inFlight = path.join(dir, 'config.json.88888.tmp');
    fs.writeFileSync(inFlight, 'writing', { mode: 0o600 });

    writePrivateFile(file, 'secret');

    assert.ok(fs.existsSync(inFlight));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('前回の強制終了で残った一時ファイルを消す', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofuro-cli-test-'));
    const file = path.join(dir, 'config.json');
    const stale = path.join(dir, 'config.json.99999.tmp');
    fs.writeFileSync(stale, 'stale', { mode: 0o600 });
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(stale, hourAgo, hourAgo);
    fs.writeFileSync(path.join(dir, 'other.txt'), 'keep');

    writePrivateFile(file, 'secret');

    assert.deepEqual(fs.readdirSync(dir).sort(), ['config.json', 'other.txt']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('パスワードをローカル PC に保存しない（案A）', () => {
  it('⚠️ 設定ファイルにパスワードが残っていても使わない', () => {
    // 以前の版で保存されたファイル（型には無い password を含む）
    const oldFile = {
      url: 'https://wiki.example.com',
      email: 'a@example.com',
      password: 'old',
    };
    const config = selectConfig({}, oldFile);
    assert.equal(config.email, 'a@example.com');
    assert.equal(config.password, undefined);
  });

  it('トークンが切れてパスワードも無ければ、利用者に ofuro login を求める', async () => {
    const auth = new Auth({
      serverUrl: 'https://wiki.example.com',
      email: 'a@example.com',
      source: ConfigSource.File,
    });
    await assert.rejects(
      auth.refresh(),
      (e: unknown) =>
        e instanceof CliError &&
        /期限/.test(e.message) &&
        /ofuro login/.test(e.hint ?? '')
    );
  });
});
