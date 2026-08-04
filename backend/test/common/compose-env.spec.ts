import * as fs from 'fs';
import * as path from 'path';

/**
 * `docker-compose.yml` が、アプリの読む環境変数をコンテナへ渡していることを確認する。
 *
 * ⚠️ **`.env` に書いても、compose の `environment` に無ければアプリには届かない。**
 * しかも**壊れ方が静か**で、既定値で動き続けるため気づけない。
 *
 * 実際にデモ環境で踏んだ（2026-08-05）。
 * `docs/deploy/README.md` が「`.env` に `TRUST_PROXY=1` を設定してください」と
 * 案内しているのに compose が渡しておらず、**手順どおりにやっても効かなかった。**
 * 監査ログの発信元が全部 Docker のゲートウェイになり、レート制限も
 * 「全利用者の合計」で働いていた。
 *
 * 同じ漏れは人の目視では防げないため、ここで機械的に突き合わせる。
 */
describe('docker-compose が環境変数を渡している', () => {
  const compose = fs.readFileSync(
    path.join(__dirname, '../../../docker-compose.yml'),
    'utf-8',
  );

  /** app サービスの environment ブロックで定義されているキー。 */
  const passed = (): Set<string> => {
    const app = compose.slice(
      compose.indexOf('\n  app:'),
      compose.indexOf('\n    volumes:', compose.indexOf('\n  app:')),
    );
    const keys = new Set<string>();
    for (const m of app.matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm)) {
      keys.add((m as any)[1]);
    }
    return keys;
  };

  /**
   * アプリが実際に読む環境変数（`process.env.X`）を、ソースから集める。
   *
   * 表を手で書くと、それ自体が古くなる。**実装から引く。**
   */
  const readByApp = (): Set<string> => {
    const root = path.join(__dirname, '../../src');
    const collect = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return collect(full);
        return e.name.endsWith('.ts') ? [full] : [];
      });

    const keys = new Set<string>();
    for (const file of collect(root)) {
      const text = fs.readFileSync(file, 'utf-8');
      for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        keys.add((m as any)[1]);
      }
      // env.X 形式（loadAlertConfig のように引数で受け取るもの）
      for (const m of text.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) {
        keys.add((m as any)[1]);
      }
    }
    return keys;
  };

  /**
   * 渡さなくてよいもの。
   * - Node/実行環境が与えるもの
   * - compose が別名で組み立てて渡しているもの
   * - 開発・テスト専用
   */
  const NOT_REQUIRED = new Set([
    'NODE_ENV', // compose が直接指定
    'PORT', // Dockerfile / compose のポート設定で決まる
    'DATABASE_URL', // DOCKER_DATABASE_URL から組み立てて渡している
    'MIGRATE_DATABASE_URL',
    'DOCKER_DATABASE_URL',
    'DOCKER_MIGRATE_DATABASE_URL',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
    'LOG_LEVEL', // 既定で十分。必要になったら追加する
    'npm_package_version',
    // #87: ⚠️ **意図的に渡さない。** イメージのビルド時に
    // ARG VERSION → ENV APP_VERSION として焼き込まれており、
    // ここで environment に書くと**実行時にその焼き込み値を上書きしてしまう**。
    'APP_VERSION',
  ]);

  it('アプリが読む環境変数がすべて compose から渡される', () => {
    const provided = passed();
    const missing = [...readByApp()]
      .filter((k) => !NOT_REQUIRED.has(k))
      .filter((k) => !provided.has(k))
      .sort();

    // 失敗時に「何が漏れているか」が出るよう、メッセージを値に含める
    expect({
      漏れ: missing,
      説明: '.env に書いても compose の app.environment に無ければ届かない',
    }).toEqual({ 漏れ: [], 説明: expect.any(String) });
  });

  // #93: これが無いとプロキシ配下で実IPが取れない。名指しで固定する
  it('TRUST_PROXY を渡している', () => {
    expect(passed().has('TRUST_PROXY')).toBe(true);
  });

  // #117: しきい値を運用で調整できること
  it('検知のしきい値を渡している', () => {
    const keys = passed();
    for (const k of [
      'ALERT_DISABLED',
      'ALERT_WINDOW_MINUTES',
      'ALERT_LOCK_THRESHOLD',
      'ALERT_SPRAY_ACCOUNT_THRESHOLD',
      'ALERT_THROTTLE_THRESHOLD',
      'ALERT_UNKNOWN_EMAIL_THRESHOLD',
      'ALERT_RESOLVE_QUIET_MINUTES',
    ]) {
      expect({ key: k, passed: keys.has(k) }).toEqual({ key: k, passed: true });
    }
  });
});
