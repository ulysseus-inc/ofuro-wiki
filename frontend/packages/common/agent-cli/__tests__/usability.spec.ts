/**
 * #277: 小さな使いにくさ。
 * 1. create で題と本文先頭の見出しが二重になる
 * 2. edit の expect に箇条書き記号が要る
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { expectMatches } from '../src/domain/editor';
import { splitTitle } from '../src/domain/page';
import { CliError } from '../src/errors';

describe('splitTitle（#277-1: 題と先頭見出しの二重表示）', () => {
  it('--title を省くと、先頭の # 見出しを題にして本文から除く', () => {
    assert.deepEqual(splitTitle('# 設計方針\n\n本文\n'), {
      title: '設計方針',
      body: '\n本文\n',
    });
  });

  it('先頭の # 見出しが --title と同じなら、本文から除く', () => {
    assert.deepEqual(splitTitle('\n# 設計方針\n本文', '設計方針'), {
      title: '設計方針',
      body: '本文',
    });
  });

  it('先頭の見出しが題と違えば、そのまま残す', () => {
    assert.deepEqual(splitTitle('# 概要\n本文', '設計方針'), {
      title: '設計方針',
      body: '# 概要\n本文',
    });
  });

  it('## 以下の見出しは題とみなさない', () => {
    assert.throws(() => splitTitle('## 小見出し\n本文'), CliError);
    assert.deepEqual(splitTitle('## 小見出し', '題'), {
      title: '題',
      body: '## 小見出し',
    });
  });

  it('⚠️ 題の末尾の # は、前に空白がある閉じ記号だけ外す（C# は残す）', () => {
    assert.equal(splitTitle('# Learning C#\n本文').title, 'Learning C#');
    assert.equal(splitTitle('# 設計方針 ##\n本文').title, '設計方針');
  });

  it('⚠️ 改行が CRLF（Windows）の Markdown でも先頭の見出しを見つける', () => {
    assert.deepEqual(splitTitle('# 設計方針\r\n\r\n本文\r\n'), {
      title: '設計方針',
      body: '\r\n本文\r\n',
    });
    assert.equal(splitTitle('# 設計方針\r\n本文', '設計方針').body, '本文');
  });

  it('--title も先頭の # 見出しも無ければ、題を求める', () => {
    assert.throws(() => splitTitle('本文だけ'), /--title/);
  });
});

describe('expectMatches（#277-2: expect の箇条書き記号）', () => {
  it('expect に記号が無ければ、箇条書き・番号付き・ToDo の記号を問わない', () => {
    assert.ok(expectMatches('項目', '* 項目'));
    assert.ok(expectMatches('項目', '1. 項目'));
    assert.ok(expectMatches('レビュー', '* [ ] レビュー'));
    assert.ok(expectMatches('完了', '* [x] 完了'));
  });

  it('箇条書きの記号は - と * を同じとみなす', () => {
    assert.ok(expectMatches('- 項目', '* 項目'));
    assert.ok(expectMatches('- [ ] レビュー', '* [ ] レビュー'));
  });

  it('⚠️ expect に記号を書いたなら、記号の違い（ToDo の完了など）は見逃さない', () => {
    assert.ok(!expectMatches('* [ ] レビュー', '* [x] レビュー'));
    assert.ok(!expectMatches('* 項目', '1. 項目'));
  });

  it('本文が違えば一致しない', () => {
    assert.ok(!expectMatches('項目A', '* 項目B'));
  });
});
