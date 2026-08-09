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

/**
 * `.env.example` が、利用者が設定できる変数を漏れなく載せていること。
 *
 * ⚠️ **compose の検査だけでは足りなかった。** compose が `${VAR}` で受け取る
 * のに `.env.example` に記載が無い変数があり（`LOG_RETENTION_DAYS` /
 * `DEFAULT_LANGUAGE`）、**セルフホストする人が存在を知る手段が無かった**。
 *
 * `.env.example` は「コピーして .env を作る」出発点であり、
 * **ここに無い設定は事実上使われない。**
 */
describe('.env.example が設定可能な変数を網羅する', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '../..');

  const composeText = (): string =>
    fs.readFileSync(path.join(root, '..', 'docker-compose.yml'), 'utf-8');

  const exampleKeys = (): Set<string> => {
    const text = fs.readFileSync(path.join(root, '.env.example'), 'utf-8');
    // コメントアウトされた行（# VAR=...）も「記載あり」とみなす
    return new Set(
      [...text.matchAll(/^#?\s*([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]),
    );
  };

  /**
   * compose が `.env` から受け取る変数（`${VAR}` / `${VAR:-既定}`）。
   * 固定値で書いているもの（`LOG_STORAGE_PATH: /data/logs`）は
   * `.env` から変えられないため対象外。
   */
  const fromDotenv = (): Set<string> =>
    new Set(
      [...composeText().matchAll(/\$\{([A-Z_][A-Z0-9_]*)(?::-[^}]*)?\}/g)].map(
        (m) => m[1],
      ),
    );

  /** `.env` に書くものではないもの。 */
  const NOT_IN_EXAMPLE = new Set([
    'POSTGRES_DB', // 既定で足りる
    'POSTGRES_USER', // 同上
    'BACKUP_HOST_PATH', // ホスト側のパス。compose の既定で足りる
    'APP_IMAGE', // イメージ運用（デモ等）でのみ使う
    'POSTGRES_IMAGE', // 同上
  ]);

  it('compose が .env から受け取る変数がすべて載っている', () => {
    const listed = exampleKeys();
    const missing = [...fromDotenv()]
      .filter((k) => !NOT_IN_EXAMPLE.has(k))
      .filter((k) => !listed.has(k))
      .sort();

    expect({
      記載漏れ: missing,
      説明: '.env.example に無い設定は、利用者が存在を知れない',
    }).toEqual({ 記載漏れ: [], 説明: expect.any(String) });
  });

  /** 実装が `process.env.X` として読む変数。 */
  const usedByApp = (): Set<string> => {
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.ts')) {
          const text: string = fs.readFileSync(full, 'utf-8');
          for (const m of text.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
            found.add(m[1]);
          }
        }
      }
    };
    walk(path.join(root, 'src'));
    return found;
  };

  /** 逆方向。実装が読まなくなった変数が残っていないか。 */
  it('実装が読まない変数が残っていない', () => {
    const used = usedByApp();
    const composeProvided = composeText();
    const stale = [...exampleKeys()]
      .filter((k) => !used.has(k))
      // compose 側で使うもの（POSTGRES_PASSWORD 等）は実装が読まなくてよい
      .filter((k) => !composeProvided.includes(k))
      .sort();

    expect({
      死んだ記載: stale,
      説明: '使われなくなった変数は .env.example から消す',
    }).toEqual({ 死んだ記載: [], 説明: expect.any(String) });
  });
});
