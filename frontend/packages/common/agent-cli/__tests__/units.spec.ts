import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Text } from '@blocksuite/affine/store';
import * as Y from 'yjs';

import { applyTextDiff } from '../src/convert/text-diff';
import { workspaceName } from '../src/convert/workspace-meta';
import { normalize } from '../src/domain/editor';
import { lineDiff } from '../src/domain/line-diff';
import { parseOps } from '../src/domain/ops';
import { CliError } from '../src/errors';
import { findCookie } from '../src/transport/auth';
import {
  ConfigSource,
  parsePageRef,
  parseServerUrl,
  selectConfig,
} from '../src/transport/config';
import { buildFixture } from './fixture';

/** Text は Y.Doc に載っていないと編集できないため、フィクスチャの段落を借りる */
function textWith(
  delta: Array<{ insert: string; attributes?: Record<string, unknown> }>
): Text {
  const { page, ids } = buildFixture();
  const model = page.store.getBlock(ids.p2)!.model as unknown as {
    props: { text: Text };
  };
  const text = model.props.text;
  page.store.transact(() => {
    text.delete(0, text.yText.length);
    let at = 0;
    for (const op of delta) {
      text.insert(op.insert, at, op.attributes);
      at += op.insert.length;
    }
  });
  return text;
}

describe('applyTextDiff', () => {
  it('真ん中だけを差し替える', () => {
    const text = textWith([{ insert: 'abcXdef' }]);
    applyTextDiff(text, [{ insert: 'abcYYdef' }]);
    assert.equal(text.toString(), 'abcYYdef');
  });

  it('書式だけを変える', () => {
    const text = textWith([{ insert: 'abc' }]);
    applyTextDiff(text, [
      { insert: 'a' },
      { insert: 'b', attributes: { bold: true } },
      { insert: 'c' },
    ]);
    assert.deepEqual(text.toDelta(), [
      { insert: 'a' },
      { insert: 'b', attributes: { bold: true } },
      { insert: 'c' },
    ]);
  });

  it('Markdown に無い属性（下線）は残す', () => {
    const text = textWith([{ insert: 'abc', attributes: { underline: true } }]);
    applyTextDiff(text, [{ insert: 'abcd' }]);
    assert.deepEqual(text.toDelta(), [
      { insert: 'abc', attributes: { underline: true } },
      { insert: 'd' },
    ]);
  });

  it('サロゲートペアを途中で切らない', () => {
    const text = textWith([{ insert: 'a😀b' }]);
    applyTextDiff(text, [{ insert: 'a😃b' }]);
    assert.equal(text.toString(), 'a😃b');
  });

  it('同じ文字列なら何もしない', () => {
    const text = textWith([{ insert: 'same', attributes: { color: 'red' } }]);
    applyTextDiff(text, [{ insert: 'same' }]);
    assert.deepEqual(text.toDelta(), [
      { insert: 'same', attributes: { color: 'red' } },
    ]);
  });
});

describe('parseOps', () => {
  it('配列も単体も受け付ける', () => {
    assert.equal(parseOps('{"op":"title","text":"a"}').length, 1);
    assert.equal(
      parseOps('[{"op":"title","text":"a"},{"op":"insert","content":"x"}]')
        .length,
      2
    );
  });

  const invalid: Array<[string, string]> = [
    ['JSON でない', 'nope'],
    ['空', '[]'],
    ['不明な op', '[{"op":"bogus"}]'],
    ['必須が無い', '[{"op":"replace","block":"b"}]'],
    [
      '型が違う',
      '[{"op":"table.set","block":"t","row":"1","col":0,"expect":"","text":""}]',
    ],
    ['位置が複数', '[{"op":"insert","after":"a","before":"b","content":"x"}]'],
    ['負の番号', '[{"op":"table.deleteRow","block":"t","index":-1}]'],
  ];
  for (const [label, json] of invalid) {
    it(`${label}は拒む`, () => {
      assert.throws(() => parseOps(json), CliError);
    });
  }
});

describe('normalize（expect の比較）', () => {
  it('字下げ・表の罫線の長さ・空白の数は無視する', () => {
    assert.equal(
      normalize('| a | b     |\n| - | ----- |'),
      normalize('      | a | b |\n      | --- | --- |')
    );
  });

  it('記号の前の \\ は無視する（read の表示は Markdown のエスケープ付き）', () => {
    assert.equal(
      normalize('EXTERNAL\\_WRITE\\_MODE=mock'),
      normalize('EXTERNAL_WRITE_MODE=mock')
    );
  });

  it('文字が違えば一致しない', () => {
    assert.notEqual(normalize('abc'), normalize('abd'));
  });
});

describe('lineDiff', () => {
  it('変わった行に印を付け、離れた同一行は省く', () => {
    assert.deepEqual(
      lineDiff(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd', 'E']),
      ['  …', '  d', '- e', '+ E']
    );
  });
});

describe('設定・認証', () => {
  it('サーバー URL を読む。ブラウザのアドレスならワークスペース ID も取り出す', () => {
    assert.deepEqual(
      parseServerUrl('https://wiki.example.com', ConfigSource.Env),
      {
        serverUrl: 'https://wiki.example.com',
        workspaceId: undefined,
      }
    );
    assert.deepEqual(
      parseServerUrl(
        'https://wiki.example.com/workspace/abc/doc1?x=1',
        ConfigSource.Env
      ),
      { serverUrl: 'https://wiki.example.com', workspaceId: 'abc' }
    );
  });

  it('URL でなければ、出所を添えて拒む', () => {
    assert.throws(
      () => parseServerUrl('not a url', ConfigSource.Env),
      (e: unknown) => e instanceof CliError && /環境変数の URL/.test(e.message)
    );
    assert.throws(
      () => parseServerUrl('ftp://wiki.example.com', ConfigSource.File),
      (e: unknown) =>
        e instanceof CliError && /設定ファイルの URL/.test(e.message)
    );
  });

  it('Set-Cookie からトークンを取り出す', () => {
    const cookies = [
      'affine_csrf_token=x; Path=/',
      'affine_token=jwt.value.sig; Path=/; HttpOnly; SameSite=Lax',
    ];
    assert.equal(findCookie(cookies, 'affine_token'), 'jwt.value.sig');
    assert.equal(findCookie(cookies, 'missing'), null);
  });
});

describe('selectConfig（3つを同じ場所から読む・送り先を絞る）', () => {
  const file = {
    url: 'https://wiki.example.com',
    email: 'file@example.com',
    password: 'file-pass',
  };
  const env = {
    OFURO_URL: 'https://wiki2.example.com',
    OFURO_EMAIL: 'env@example.com',
    OFURO_PASSWORD: 'env-pass',
  };

  it('環境変数に URL があれば、環境変数の3つを使う', () => {
    const config = selectConfig(env, file);
    assert.equal(config.serverUrl, 'https://wiki2.example.com');
    assert.equal(config.email, 'env@example.com');
    assert.equal(config.source, ConfigSource.Env);
  });

  it('環境変数が無ければ、設定ファイルの URL・メールを使う（パスワードは保存しない）', () => {
    const config = selectConfig({}, file);
    assert.equal(config.serverUrl, 'https://wiki.example.com');
    assert.equal(config.email, 'file@example.com');
    assert.equal(config.password, undefined);
    assert.equal(config.source, ConfigSource.File);
  });

  it('⚠️ 混ぜない。環境変数に URL だけなら、設定ファイルのパスワードは使わない', () => {
    const config = selectConfig(
      { OFURO_URL: 'https://evil.example.net' },
      file
    );
    assert.equal(config.email, undefined);
    assert.equal(config.password, undefined);
  });

  it('環境変数にメール・パスワードだけ（URL 無し）は、3つ揃えるよう求める', () => {
    assert.throws(
      () => selectConfig({ OFURO_EMAIL: 'a', OFURO_PASSWORD: 'b' }, file),
      /環境変数は 3 つ揃えて設定する/
    );
  });

  it('--url が同じサーバーならメールを使い、URL 中のワークスペースを既定にする', () => {
    const config = selectConfig(
      {},
      file,
      'https://wiki.example.com/workspace/ws2/x'
    );
    assert.equal(config.email, 'file@example.com');
    assert.equal(config.workspace, 'ws2');
  });

  it('⚠️ --url が別のサーバーなら、パスワードを渡さない', () => {
    const config = selectConfig(env, file, 'https://evil.example.net');
    assert.equal(config.serverUrl, 'https://evil.example.net');
    assert.equal(config.email, undefined);
    assert.equal(config.password, undefined);
  });

  it('旧形式の OFURO_WORKSPACE_URL・workspaceUrl も読む（ワークスペースは既定として）', () => {
    const fromEnv = selectConfig(
      {
        ...env,
        OFURO_URL: undefined,
        OFURO_WORKSPACE_URL: 'https://wiki2.example.com/workspace/ws9',
      },
      {}
    );
    assert.equal(fromEnv.serverUrl, 'https://wiki2.example.com');
    assert.equal(fromEnv.workspace, 'ws9');
    assert.equal(fromEnv.password, 'env-pass');

    const fromFile = selectConfig(
      {},
      {
        workspaceUrl: 'https://wiki.example.com/workspace/ws8',
        email: 'f',
      }
    );
    assert.equal(fromFile.workspace, 'ws8');
    assert.equal(fromFile.email, 'f');
  });

  it('何も無ければ ofuro login を案内する', () => {
    assert.throws(() => selectConfig({}, {}), /サーバーの URL が未設定/);
  });
});

describe('parsePageRef（ページの指定）', () => {
  it('docId だけならそのまま', () => {
    assert.deepEqual(parsePageRef('abc'), { docId: 'abc' });
    assert.deepEqual(parsePageRef('ws1/abc'), { docId: 'ws1/abc' });
  });

  it('ページ URL からワークスペースと docId を取り出す', () => {
    assert.deepEqual(
      parsePageRef('https://wiki.example.com/workspace/ws1/abc?mode=edgeless'),
      { workspaceId: 'ws1', docId: 'abc' }
    );
  });

  it('壊れた URL は CliError にする', () => {
    assert.throws(() => parsePageRef('http://[bad'), CliError);
    assert.throws(
      () => parsePageRef('https://wiki.example.com/workspace/ws1/%E0%A4%A'),
      CliError
    );
    assert.throws(
      () => parsePageRef('https://wiki.example.com/other'),
      CliError
    );
  });
});

describe('workspaceName（ワークスペースの表示名）', () => {
  it('ルート文書の meta.name を読む（画面に出ている名前）', () => {
    const doc = new Y.Doc();
    doc.getMap('meta').set('name', '社内Wiki');
    assert.equal(workspaceName(Y.encodeStateAsUpdate(doc)), '社内Wiki');
  });

  it('名前が無い・空のルート文書は undefined（呼び出し側が DB の名前で補う）', () => {
    assert.equal(workspaceName(new Uint8Array()), undefined);
    assert.equal(workspaceName(Y.encodeStateAsUpdate(new Y.Doc())), undefined);
  });
});
