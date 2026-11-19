import { describe, expect, test } from 'vitest';

import { userGuideUrl } from '../user-guide';

/** #324: ガイド（/docs/）の入口。画面の言語で日本語版と英語版を選ぶ（docs/docs-site.md 5.1） */
describe('userGuideUrl', () => {
  test('日本語なら /docs/', () => {
    expect(userGuideUrl('ja')).toBe('/docs/');
  });

  test('日本語以外は英語版 /docs/en/', () => {
    expect(userGuideUrl('en')).toBe('/docs/en/');
    expect(userGuideUrl('zh-Hans')).toBe('/docs/en/');
  });

  test('章を指定できる', () => {
    expect(userGuideUrl('ja', 'user/')).toBe('/docs/user/');
    expect(userGuideUrl('en', 'user/')).toBe('/docs/en/user/');
  });
});
