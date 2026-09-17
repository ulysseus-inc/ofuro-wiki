import { DiscoveryRevisionService } from '../../../src/modules/discovery/discovery-revision.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #151 PR2: **台帳が変わったことをクライアントへ知らせる**（7.11）。
 *
 * ⚠️ 段階2 までは共有目次（Yjs）が動くことが配信を兼ねていた。
 * 段階3 で目次への書き込みをやめ、目次を空にしたため**その経路が消え**、
 * **他人の変更が相手の一覧に出なくなっていた**
 * （`e2e/sync.spec.ts`「一方が作ったページが、もう一方の一覧に現れる」）。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.11
 */
describe('台帳の変更通知（#151 PR2）', () => {
  const WS = 'ws-1';

  const make = (opts: { updateThrows?: Error } = {}) => {
    const prisma = {
      workspace: {
        update: jest.fn().mockImplementation(() => {
          if (opts.updateThrows) return Promise.reject(opts.updateThrows);
          return Promise.resolve({ id: WS });
        }),
        findUnique: jest.fn().mockResolvedValue({ discoveryRevision: 5n }),
      },
    };
    return {
      prisma,
      service: new DiscoveryRevisionService(prisma as unknown as PrismaService),
    };
  };

  test('版数を上げたら知らせる', async () => {
    const { service } = make();
    const heard: Array<[string, string]> = [];
    service.onChanged((ws, reason) => heard.push([ws, reason]));

    await service.bump(WS, 'doc-create');

    expect(heard).toEqual([[WS, 'doc-create']]);
  });

  test('登録した相手すべてに届く', async () => {
    const { service } = make();
    const a = jest.fn();
    const b = jest.fn();
    service.onChanged(a);
    service.onChanged(b);

    await service.bump(WS, 'doc-delete');

    expect(a).toHaveBeenCalledWith(WS, 'doc-delete');
    expect(b).toHaveBeenCalledWith(WS, 'doc-delete');
  });

  /**
   * ⚠️ **知らせるのは書き込みの「あと」だけ。**
   *
   * 先に知らせると、受け取った側が**古い一覧と新しい版数**を手元に固定し、
   * 以後サーバーと版数が一致するため**永久に取り直さない**。
   */
  test('⚠️ 版数を上げてから知らせる（順序）', async () => {
    const calls: string[] = [];
    const prisma = {
      workspace: {
        update: jest.fn().mockImplementation(() => {
          calls.push('update');
          return Promise.resolve({ id: WS });
        }),
        findUnique: jest.fn(),
      },
    };
    const service = new DiscoveryRevisionService(
      prisma as unknown as PrismaService,
    );
    service.onChanged(() => calls.push('notify'));

    await service.bump(WS, 'doc-update');

    expect(calls).toEqual(['update', 'notify']);
  });

  /**
   * ⚠️ **上げられなかったなら知らせない。**
   * 知らせても受け取った側は「変わっていない」と判断して終わる。
   * 無駄な問い合わせが全員に走るだけ。
   */
  test('⚠️ 版数を上げられなかったら知らせない', async () => {
    const { service } = make({ updateThrows: new Error('ワークスペースが無い') });
    const heard = jest.fn();
    service.onChanged(heard);

    // ⚠️ 呼び出し元を巻き込まないこと（保存が失敗してはいけない）
    await expect(service.bump(WS, 'doc-create')).resolves.toBeUndefined();

    expect(heard).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ **知らせる相手の失敗で呼び出し元を巻き込まない。**
   * 配信できなくてもデータは正しく、受け取り側は次の契機で追いつく。
   * ここで投げると**ドキュメントの保存自体が失敗する**。
   */
  test('⚠️ 知らせる相手が落ちても、保存は失敗しない', async () => {
    const { service } = make();
    const second = jest.fn();
    service.onChanged(() => {
      throw new Error('配信できない');
    });
    service.onChanged(second);

    await expect(service.bump(WS, 'doc-create')).resolves.toBeUndefined();

    // ⚠️ 1つ落ちても、後ろの相手には届くこと
    expect(second).toHaveBeenCalled();
  });

  test('登録した相手が無くても落ちない', async () => {
    const { service } = make();

    await expect(service.bump(WS, 'doc-trash')).resolves.toBeUndefined();
  });
});
