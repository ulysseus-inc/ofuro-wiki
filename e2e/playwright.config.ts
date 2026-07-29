import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  // #89: E2E はすべて同じバックエンド・同じ DB を共有する。
  // 特に sso.spec.ts はサーバー設定（OIDC の有効/無効）を書き換えるため、
  // ファイル同士を並列実行すると互いに干渉する（負荷による遅延も含む）。
  // 各ファイルは既に mode:'serial' を前提に書かれているので、ファイル間も直列にする。
  workers: 1,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3010',
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 15_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
