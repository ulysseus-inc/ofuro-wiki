import * as fs from 'fs';
import * as path from 'path';
import { DiscoveryRevisionService } from '../../../src/modules/discovery/discovery-revision.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #151: Discovery Index の版数。
 *
 * ⚠️ **上げ忘れると「権限は正しいのに一覧が古い」状態になる。**
 * しかもエラーは出ない。機械的に検査する。
 */
describe('Discovery Index の版数', () => {
  const makeService = (opts: { fail?: boolean; value?: bigint } = {}) => {
    const prisma = {
      workspace: {
        update: jest.fn().mockImplementation(() => {
          if (opts.fail) throw new Error('boom');
          return Promise.resolve({});
        }),
        findUnique: jest
          .fn()
          .mockResolvedValue({ discoveryRevision: opts.value ?? 0n }),
      },
    };
    return {
      service: new DiscoveryRevisionService(prisma as unknown as PrismaService),
      prisma,
    };
  };

  it('版数を1つ進める', async () => {
    const { service, prisma } = makeService();
    await service.bump('ws-1', 'doc-update');
    expect(prisma.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ws-1' },
        data: { discoveryRevision: { increment: 1 } },
      }),
    );
  });

  /**
   * ⚠️ **版数の更新に失敗しても、呼び出し元を巻き込まない。**
   * ここで例外を投げると、ドキュメントの保存自体が失敗してしまう。
   * 版数が上がらなくてもデータは正しく、次の変更で追いつく。
   */
  it('更新に失敗しても例外を投げない', async () => {
    const { service } = makeService({ fail: true });
    await expect(service.bump('ws-1', 'doc-update')).resolves.toBeUndefined();
  });

  /** ⚠️ BigInt は JSON にできない。文字列で返すこと。 */
  it('版数を文字列で返す', async () => {
    const { service } = makeService({ value: 9007199254740993n });
    const v = await service.current('ws-1');
    expect(typeof v).toBe('string');
    expect(v).toBe('9007199254740993');
  });

  it('ワークスペースが無ければ 0', async () => {
    const prisma = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const s = new DiscoveryRevisionService(prisma as unknown as PrismaService);
    expect(await s.current('ws-x')).toBe('0');
  });
});

/**
 * ⚠️ **Index に影響する変更が、すべて版数を上げていること。**
 *
 * 上げ忘れは「一覧が古いまま」という形でしか現れず、エラーにならない。
 * 呼び出しの有無を機械的に確かめる。
 */
describe('版数の上げ忘れ', () => {
  const source = (rel: string) =>
    fs.readFileSync(path.join(__dirname, '../../../src/modules', rel), 'utf-8');

  const bodyOf = (text: string, name: string) => {
    const start = text.indexOf(`async ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const next = text.indexOf('\n  async ', start + 1);
    return text.slice(start, next === -1 ? undefined : next);
  };

  it.each([
    // Index の内容が変わるもの
    ['upsertDocMeta', 'タイトル・タグが変わる'],
    // 誰に見えるかが変わるもの
    ['grantDocUserRole', '権限を配る'],
    ['revokeDocUserRole', '権限を外す'],
    ['updateDocDefaultRole', '既定ロールを変える'],
  ])('%s が版数を上げる（%s）', (name) => {
    expect(bodyOf(source('doc/doc.service.ts'), name)).toContain(
      'this.discovery.bump(',
    );
  });

  /**
   * ⚠️ Discovery Metadata に本文を混ぜないこと。
   * 「存在を知るための情報だけ」という約束が崩れる。
   */
  it('Snapshot に本文を含めない', () => {
    const text = source('discovery/discovery.service.ts');
    const start = text.indexOf(
      'const metas = await this.prisma.docMeta.findMany',
    );
    const select = text.slice(start, text.indexOf('});', start));
    for (const forbidden of ['blob', 'content:', 'snapshot']) {
      expect(select).not.toContain(forbidden);
    }
  });
});

/**
 * ⚠️ **`doc_meta` を書き換える経路が、すべて版数を上げていること。**
 *
 * 最初に `DocService` だけを配線したところ、**3箇所が漏れていた**
 * （内部APIの upsert・同期層の削除・バックアップ復元）。
 * どれも `DocService` を通らず直接 Prisma を叩いていたため。
 *
 * 上げ忘れは「一覧が古いまま」という形でしか現れず、エラーにならない。
 * **新しい書き換え経路が増えたら、ここで検出する。**
 */
describe('Index を書き換える経路の網羅', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = path.join(__dirname, '../../../src');

  const collect = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: any) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return collect(full);
      return e.name.endsWith('.ts') ? [full] : [];
    });

  /**
   * ⚠️ **メソッド単位で見ること。**
   *
   * 最初ファイル単位（「そのファイルに bump があるか」）で検査したところ、
   * **同じファイル内の他のメソッドが bump していれば通ってしまい**、
   * `publishPage` / `revokePublicPage` の抜けを見逃した。
   */
  const methodsOf = (text: string): Array<{ name: string; body: string }> => {
    const out: Array<{ name: string; body: string }> = [];
    const re = /\n  (?:private |public )?async (\w+)\(/g;
    const starts: Array<{ name: string; at: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      starts.push({ name: m[1], at: m.index });
    }
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1].at : text.length;
      out.push({ name: starts[i].name, body: text.slice(starts[i].at, end) });
    }
    return out;
  };

  /** Index に影響する書き込み。読み取り（findMany 等）は対象外。 */
  const WRITES =
    /\b(docMeta|workspaceMember)\.(upsert|create|update|delete|deleteMany|updateMany)\b/;

  /** 版数を上げなくてよいもの（理由を明記すること）。 */
  const EXEMPT: Record<string, string> = {
    'modules/backup/scheduled-backup.service.ts::restoreFromBackup':
      '復元で総入れ替え。最後にまとめて上げる',
    'modules/backup/backup.service.ts::importWorkspace':
      '取り込みの最後に1回だけ上げる',
    'modules/workspace/workspace.service.ts::createWorkspace':
      '作りたての空ワークスペース。まだ誰も Snapshot を持たない',
    'modules/workspace/workspace.service.ts::inviteByEmail':
      '招待しただけでは参加していない（受諾時に上げる）',
    // #151 段階3（7.10.6）。⚠️ ここで上げると**打鍵のたびに全員が
    // 一覧を取り直す**。書き換えるのは updated_at だけで、影響は
    // 並び順と鮮度表示にとどまる（誰が何を見られるかは変わらない）
    'modules/sync/sync.service.ts::pushUpdate':
      '本文の保存ごとに走る。上げると打鍵のたびに全クライアントが取り直す',
  };

  it('Index を書き換えるメソッドが版数を上げている', () => {
    const offenders: string[] = [];

    for (const file of collect(SRC)) {
      const text: string = fs.readFileSync(file, 'utf-8');
      if (!WRITES.test(text)) continue;
      const rel = path.relative(SRC, file).replace(/\\/g, '/');

      for (const { name, body } of methodsOf(text)) {
        if (!WRITES.test(body)) continue;
        const key = `${rel}::${name}`;
        if (EXEMPT[key]) continue;
        // 同じメソッド内、または直接呼ぶ形で上げていること
        if (!/discovery\.bump\(/.test(body)) offenders.push(key);
      }
    }

    expect({
      版数を上げていないメソッド: offenders.sort(),
      対処:
        'DiscoveryRevisionService.bump を書き込みの「あと」に呼ぶ' +
        '（不要なら理由を添えて EXEMPT に追記）',
    }).toEqual({ 版数を上げていないメソッド: [], 対処: expect.any(String) });
  });
});

/**
 * ⚠️ **版数は書き込んだ「あと」に上げること。**
 *
 * 先に上げると、その間に Snapshot を取ったクライアントが
 * 「**新しい版数 ＋ 古い一覧**」を手元に固定する。以後サーバーと版数が
 * 一致するため**永久に取り直さない** — 版数の仕組みそのものが無効になる。
 *
 * | | 正しい順序 |
 * |---|---|
 * | 書き込み側 | データを書いてから版数を上げる |
 * | 読み取り側 | 版数を取ってからデータを読む |
 *
 * この組み合わせなら、ずれても「余分に1回取り直す」だけで済む。
 */
describe('版数を上げる順序', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = path.join(__dirname, '../../../src/modules');

  const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf-8');

  const bodyOf = (text: string, name: string) => {
    const start = text.indexOf(`async ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const next = text.indexOf('\n  async ', start + 1);
    return text.slice(start, next === -1 ? undefined : next);
  };

  it.each([
    ['doc/doc.service.ts', 'upsertDocMeta', 'docMeta.upsert'],
    ['doc/doc.service.ts', 'grantDocUserRole', 'docPermission.upsert'],
    ['doc/doc.service.ts', 'revokeDocUserRole', 'docPermission.deleteMany'],
    ['doc/doc.service.ts', 'updateDocDefaultRole', 'docMeta.upsert'],
    // #45: 完全削除の消す処理は DocGcService へ移した
    // （space:delete-doc と deleteDocMeta の両方が通る1か所）
    ['discovery/doc-gc.service.ts', 'purge', '$transaction'],
  ])('%s の %s は書き込みのあとに上げる', (file, name, write) => {
    const body = bodyOf(read(file), name);
    const writeAt = body.indexOf(write);
    const bumpAt = body.indexOf('discovery.bump(');
    expect(writeAt).toBeGreaterThan(-1);
    expect(bumpAt).toBeGreaterThan(-1);

    expect({
      対象: `${name}`,
      書き込みより後に上げているか: bumpAt > writeAt,
      対処: '先に上げると「新しい版数＋古い一覧」が永久に固定される',
    }).toEqual({
      対象: `${name}`,
      書き込みより後に上げているか: true,
      対処: expect.any(String),
    });
  });

  /** 内部API（DocService を通らない経路）も同じ。 */
  it('内部APIの upsert は書き込みのあとに上げる', () => {
    const text = read('doc/internal-doc.controller.ts');
    const writeAt = text.lastIndexOf('docSnapshot.upsert');
    const bumpAt = text.indexOf('discovery.bump(');
    expect(bumpAt).toBeGreaterThan(writeAt);
  });

  /**
   * ⚠️ 読み取り側は逆。**版数を取ってからデータを読む。**
   * あとで取ると、その間の変更を「取り込み済み」と誤認する。
   */
  it('Snapshot は版数を取ってからデータを読む', () => {
    const text = read('discovery/discovery.service.ts');
    const revAt = text.indexOf('this.revision.current(');
    const readAt = text.indexOf('docMeta.findMany');
    expect(revAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(revAt);
  });
});

/**
 * ⚠️ **宣言だけあって呼ばれていない理由が無いこと。**
 *
 * `permission-workspace` を定義したまま呼び出しを1つも書いておらず、
 * メンバーの増減でキャッシュが失効しない状態だった（レビューで発覚）。
 * `doc-trash` / `doc-restore` も同様に宣言だけ残っていた。
 *
 * **「一覧に載っている＝実装済み」と誤解させないため、
 * 呼ばれていない値は置かない。**
 */
describe('宣言した理由がすべて使われている', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = path.join(__dirname, '../../../src');

  const collect = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: any) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return collect(full);
      return e.name.endsWith('.ts') ? [full] : [];
    });

  it('DISCOVERY_CHANGE_REASONS に未使用の値が無い', () => {
    const {
      DISCOVERY_CHANGE_REASONS,
      // eslint-disable-next-line @typescript-eslint/no-var-requires
    } = require('../../../src/modules/discovery/discovery-revision.service');

    // 呼び出し側（宣言しているファイル自身は除く）を全部読む
    const callers = collect(SRC)
      .filter((f) => !f.endsWith('discovery-revision.service.ts'))
      .map((f) => fs.readFileSync(f, 'utf-8'))
      .join('\n');

    const unused = (DISCOVERY_CHANGE_REASONS as string[]).filter(
      (r) => !callers.includes(`'${r}'`),
    );

    expect({
      呼ばれていない理由: unused.sort(),
      対処:
        '実際に bump を呼ぶか、一覧から外す' +
        '（載っていると「実装済み」と誤解される）',
    }).toEqual({ 呼ばれていない理由: [], 対処: expect.any(String) });
  });
});
