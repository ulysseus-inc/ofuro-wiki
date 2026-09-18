import { describe, expect, test } from 'vitest';

import { pickInitialLanguage } from '../initial-language';

/**
 * #245: ⚠️ **初めて開いた人の言語を、ブラウザに合わせる。**
 *
 * これまで既定が日本語に固定されており、英語圏の人が開いても
 * 日本語の画面で始まっていた。README もマニュアルも英語を用意したのに、
 * **入口だけが日本語**という状態だった。
 *
 * ⚠️ **すでに選んだ人の設定は動かさない。** 保存された値があれば必ずそれを使う。
 */
describe('最初に見せる言語（#245）', () => {
  const supported = ['en', 'ja', 'zh-Hans'];

  describe('保存された設定がある', () => {
    test('⚠️ ブラウザの言語より、保存された設定を優先する', () => {
      expect(pickInitialLanguage('ja', ['en-US'], supported)).toBe('ja');
      expect(pickInitialLanguage('en', ['ja-JP'], supported)).toBe('en');
    });

    test('対応していない値が保存されていたら、ブラウザに従う', () => {
      expect(pickInitialLanguage('xx', ['ja-JP'], supported)).toBe('ja');
    });
  });

  describe('初めて開いた（保存された設定が無い）', () => {
    test.each([
      ['日本語のブラウザ', ['ja-JP', 'en-US'], 'ja'],
      ['英語のブラウザ', ['en-US'], 'en'],
      ['英語（イギリス）', ['en-GB'], 'en'],
      ['ドイツ語（未対応）', ['de-DE'], 'en'],
      ['中国語（対応あり）', ['zh-Hans-CN'], 'zh-Hans'],
    ])('%s → %s', (_name, languages, expected) => {
      expect(pickInitialLanguage(undefined, languages as string[], supported)).toBe(
        expected
      );
    });

    test('ブラウザの言語が分からなければ英語にする', () => {
      expect(pickInitialLanguage(undefined, [], supported)).toBe('en');
    });

    /**
     * ⚠️ 2番目以降の希望も見る。1番目が未対応でも、
     * 日本語を希望している人には日本語を出す。
     */
    test('2番目以降の希望も見る', () => {
      expect(pickInitialLanguage(undefined, ['de-DE', 'ja'], supported)).toBe('ja');
    });
  });
});
