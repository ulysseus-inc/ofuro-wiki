import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * OSS 公開時の除外が **fail-safe** であること。
 *
 * ⚠️ **列挙式にしてはいけない。** 一度 `.env.local` `.env.production` …と
 * 個別に並べたことがあるが、その形だと将来 `.env.staging` のような
 * ファイルが増えたとき**除外し忘れて公開される**。
 *
 * 一方 `.env.example` は秘密を含まないテンプレートで、
 * **セルフホストする人が設定の存在を知る唯一の手段**である。
 * 以前これが `.env.*` に巻き込まれ、公開版が初回のまま更新されていなかった。
 */
describe('OSS 公開の除外パターン', () => {
  const root = path.join(__dirname, '../../..');

  /** rsync を実際に走らせ、何が公開されるかを見る。 */
  const publish = (files: string[]): string[] => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-'));
    const src = path.join(dir, 'src', 'backend');
    fs.mkdirSync(src, { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(src, f), 'SECRET=x\n');

    // scripts/oss-publish.sh と同じ引数順（--include が先）
    execFileSync('rsync', [
      '-a',
      '--delete',
      '--include=.env.example',
      `--exclude-from=${path.join(root, '.ossignore')}`,
      '--exclude=.git',
      `${path.join(dir, 'src')}/`,
      `${path.join(dir, 'out')}/`,
    ]);

    const out = path.join(dir, 'out', 'backend');
    const result = fs.existsSync(out)
      ? fs.readdirSync(out).filter((f) => f.startsWith('.env'))
      : [];
    fs.rmSync(dir, { recursive: true, force: true });
    return result.sort();
  };

  it('.env.example だけが公開される', () => {
    const published = publish(['.env', '.env.example', '.env.production']);
    expect(published).toEqual(['.env.example']);
  });

  /**
   * ⚠️ **これが本命。** 想定していない名前でも除外されること。
   * 列挙式に戻すとここで落ちる。
   */
  it.each(['.env.staging', '.env.secrets', '.env.prod.local', '.env.foo'])(
    '未知の %s も公開されない',
    (name) => {
      expect(publish([name, '.env.example'])).toEqual(['.env.example']);
    },
  );

  it('.ossignore が網羅的な指定を保っている', () => {
    const text = fs.readFileSync(path.join(root, '.ossignore'), 'utf-8');
    // 個別列挙に戻っていないこと
    expect(text).toMatch(/^\.env\.\*$/m);
  });

  /**
   * ⚠️ rsync は引数順に評価する。--include を --exclude-from の後ろに
   * 置くと `.env.*` に先に捕まり、テンプレートが公開されなくなる。
   */
  it('publish スクリプトが --include を先に置いている', () => {
    const script = fs.readFileSync(
      path.join(root, 'scripts', 'oss-publish.sh'),
      'utf-8',
    );
    const include = script.indexOf('--include=".env.example"');
    const excludeFrom = script.indexOf('--exclude-from=');
    expect(include).toBeGreaterThan(-1);
    expect(include).toBeLessThan(excludeFrom);
  });
});
