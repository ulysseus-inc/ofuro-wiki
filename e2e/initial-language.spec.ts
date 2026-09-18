import { test, expect } from '@playwright/test';

/**
 * #245: ⚠️ **初めて開いた人の画面が、ブラウザの言語に合うこと。**
 *
 * 既定が日本語に固定されており、英語圏の人が開いても日本語の画面で始まっていた。
 * README もマニュアルも英語を用意したのに、**入口だけが日本語**だった。
 *
 * ⚠️ サインイン前の画面で見る。利用者ごとの設定に触れずに確かめられるため。
 */
test.describe('初めて開いたときの言語（#245）', () => {
  test('英語のブラウザなら、英語で始まる', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    try {
      await page.goto('/');
      await page.waitForTimeout(5_000);
      const text = await page.locator('body').innerText();

      expect(text).toContain('Sign in');
      expect(text).not.toContain('サインイン');
    } finally {
      await context.close();
    }
  });

  test('日本語のブラウザなら、日本語で始まる', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'ja-JP' });
    const page = await context.newPage();
    try {
      await page.goto('/');
      await page.waitForTimeout(5_000);
      const text = await page.locator('body').innerText();

      expect(text).toMatch(/サインイン|メールアドレス/);
    } finally {
      await context.close();
    }
  });
});
