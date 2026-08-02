import {
  redactUrl,
  shouldLog,
} from '../../../src/modules/logging/access-log.middleware';

describe('アクセスログ (#90)', () => {
  describe('redactUrl', () => {
    // ⚠️ #115 のパスワード変更 URL をそのまま残すと、
    // アクセスログを読める者がそのトークンでパスワードを変更できてしまう
    it('token を伏せる', () => {
      expect(
        redactUrl('/auth/changePassword?token=e61c45a7e1d441e9e1ebf5899822'),
      ).toBe('/auth/changePassword?token=***');
    });

    it.each([
      ['password', '/x?password=hunter2'],
      ['secret', '/x?secret=abc'],
      ['code', '/x?code=abc'],
      ['state', '/x?state=abc'],
    ])('%s を伏せる', (key, url) => {
      expect(redactUrl(url)).toBe(`/x?${key}=***`);
    });

    it('大文字の指定でも伏せる', () => {
      expect(redactUrl('/x?TOKEN=abc')).toBe('/x?TOKEN=***');
    });

    it('秘匿値だけを伏せ、他のパラメータは残す', () => {
      expect(redactUrl('/x?page=2&token=abc&sort=name')).toBe(
        '/x?page=2&token=***&sort=name',
      );
    });

    it('クエリが無ければそのまま', () => {
      expect(redactUrl('/api/health')).toBe('/api/health');
    });

    it('パス部分は書き換えない', () => {
      expect(redactUrl('/api/token/list?token=abc')).toBe(
        '/api/token/list?token=***',
      );
    });
  });

  describe('shouldLog', () => {
    it.each([
      ['/api/auth/sign-in', 200],
      ['/graphql', 200],
    ])('API は記録する (%s)', (url, status) => {
      expect(shouldLog(url, status)).toBe(true);
    });

    // engine.io のハンドシェイクは Express を通らないため、
    // ここに含めても記録されない（実測で0件）。誤解を招くので対象にしない
    it('WebSocket のハンドシェイクは対象にしない', () => {
      expect(shouldLog('/socket.io/?EIO=4', 200)).toBe(false);
    });

    // アプリがフロントを配信しているため、全記録では1画面で数百行出る
    it.each([
      '/js/index.js',
      '/assets/logo.png',
      '/',
    ])('静的ファイルの成功応答は記録しない (%s)', (url) => {
      expect(shouldLog(url, 200)).toBe(false);
    });

    // エラーは障害の兆候なので、静的ファイルでも残す
    it('静的ファイルでもエラー応答は記録する', () => {
      expect(shouldLog('/js/index.js', 404)).toBe(true);
      expect(shouldLog('/', 500)).toBe(true);
    });

    // 30秒ごとに鳴り続けるため、成功時は捨てる
    it('ヘルスチェックの成功は記録しない', () => {
      expect(shouldLog('/api/health', 200)).toBe(false);
    });

    it('ヘルスチェックでも失敗は記録する', () => {
      expect(shouldLog('/api/health', 503)).toBe(true);
    });
  });
});
