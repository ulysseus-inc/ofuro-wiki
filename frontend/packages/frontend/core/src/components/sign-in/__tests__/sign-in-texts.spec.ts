import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import en from '../../../../../i18n/src/resources/en.json';
import ja from '../../../../../i18n/src/resources/ja.json';

/**
 * サインインの画面の文言は、画面の言語で出す。
 * 「ログイン画面に戻る」を日本語のまま書いていて、英語の画面でも日本語で出ていた（2026-11-11 手順書の撮影で発覚）
 */
describe('サインインの画面の文言', () => {
  const KEY = 'com.ofuro.auth.back-to-sign-in';
  const source = readFileSync(join(__dirname, '../sign-in-with-password.tsx'), 'utf8');

  test('「ログイン画面に戻る」を書き込まず、翻訳の鍵から出す', () => {
    expect(source).not.toContain('ログイン画面に戻る');
    expect(source).toContain(`t['${KEY}']()`);
  });

  test('日本語と英語の両方に文言がある', () => {
    expect((ja as Record<string, string>)[KEY]).toBe('ログイン画面に戻る');
    expect((en as Record<string, string>)[KEY]).toBe('Back to sign in');
  });
});
