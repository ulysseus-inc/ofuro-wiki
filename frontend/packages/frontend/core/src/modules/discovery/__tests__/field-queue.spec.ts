import { describe, expect, test } from 'vitest';

import { FieldQueue } from '../field-queue';

/**
 * #151 段階3: **送信は編集した順に行う**（7.5.8）。
 *
 * ⚠️ `send()` は待たないため、同じフィールドを続けて編集すると
 * 呼び出しごとに別の非同期の鎖が走る。順を保証しないと、
 * **控えのまとめで古い値が後勝ちし、利用者の最新の変更が巻き戻る。**
 */
describe('#151 段階3 フィールドごとの順番待ち', () => {
  /** 好きなタイミングで終わらせられる仕事 */
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  /**
   * ⚠️ **これが本丸。** 2番目の仕事は、1番目が終わるまで始まってはいけない。
   * 始まってしまうと応答の順が編集の順とずれ、古い値が後勝ちする。
   */
  test('⚠️ 前の送信が終わるまで、次の送信を始めない', async () => {
    const queue = new FieldQueue();
    const first = deferred();
    const started: string[] = [];

    void queue.add('題', () => {
      started.push('B');
      return first.promise;
    });
    const second = queue.add('題', () => {
      started.push('C');
      return Promise.resolve();
    });

    await Promise.resolve();
    expect(started).toEqual(['B']);

    first.resolve();
    await second;
    expect(started).toEqual(['B', 'C']);
  });

  test('積んだ順に実行される', async () => {
    const queue = new FieldQueue();
    const done: number[] = [];

    const tasks = [1, 2, 3].map(n =>
      queue.add('題', async () => {
        // わざと後のものほど速く終わるようにする
        await new Promise(r => setTimeout(r, (4 - n) * 5));
        done.push(n);
      })
    );

    await Promise.all(tasks);
    expect(done).toEqual([1, 2, 3]);
  });

  /**
   * ⚠️ **鎖を切らないこと。** 失敗で切れると、以降に積んだ分が
   * 二度と送られない（通信断のたびに以後の変更を全部落とす）。
   */
  test('⚠️ 前の送信が失敗しても、次の送信は実行される', async () => {
    const queue = new FieldQueue();
    const done: string[] = [];

    void queue
      .add('題', () => Promise.reject(new Error('通信断')))
      .catch(() => {});
    await queue.add('題', () => {
      done.push('次');
      return Promise.resolve();
    });

    expect(done).toEqual(['次']);
  });

  /**
   * ⚠️ **フィールドごとに分けること。** ドキュメント単位で直列化すると、
   * 遅い題の送信がゴミ箱の送信を待たせる。
   */
  test('⚠️ 鍵が違えば待たされない', async () => {
    const queue = new FieldQueue();
    const blocker = deferred();
    const started: string[] = [];

    void queue.add('題', () => {
      started.push('題');
      return blocker.promise;
    });
    await queue.add('ゴミ箱', () => {
      started.push('ゴミ箱');
      return Promise.resolve();
    });

    expect(started).toEqual(['題', 'ゴミ箱']);
    blocker.resolve();
  });

  describe('順番待ちの片付け', () => {
    test('全部終われば残らない', async () => {
      const queue = new FieldQueue();
      await queue.add('題', () => Promise.resolve());
      expect(queue.size).toBe(0);
    });

    test('失敗して終わっても残らない', async () => {
      const queue = new FieldQueue();
      await queue.add('題', () => Promise.reject(new Error('x'))).catch(() => {});
      // 片付けは次のマイクロタスクで走る
      await Promise.resolve();
      expect(queue.size).toBe(0);
    });

    /**
     * ⚠️ **自分が末尾のときだけ片付けること。**
     * 無条件に消すと、実行中にあとから積まれた分を取りこぼし、
     * 次に積んだものが**割り込んで先に走る**。
     */
    test('⚠️ 実行中に積まれた分を取りこぼさない', async () => {
      const queue = new FieldQueue();
      const first = deferred();
      const order: string[] = [];

      const a = queue.add('題', () => {
        order.push('A開始');
        return first.promise;
      });
      const b = queue.add('題', () => {
        order.push('B開始');
        return Promise.resolve();
      });

      first.resolve();
      await Promise.all([a, b]);

      expect(order).toEqual(['A開始', 'B開始']);
      expect(queue.size).toBe(0);
    });
  });

  /**
   * ⚠️ **サーバーの値を手元へ巻き戻してよいかの判断に使う**（3c / #182）。
   * 待っている変更があるのに巻き戻すと、そのあと送られる新しい値と
   * **画面が食い違ったままになる**（送信は成功するのに画面は古い値）。
   */
  describe('待っている仕事があるか', () => {
    test('何も積んでいなければ無い', () => {
      expect(new FieldQueue().hasWaiting('題')).toBe(false);
    });

    test('積んだら有る', () => {
      const queue = new FieldQueue();
      const blocker = deferred();
      void queue.add('題', () => blocker.promise);
      void queue.add('題', () => Promise.resolve());

      expect(queue.hasWaiting('題')).toBe(true);
      blocker.resolve();
    });

    /**
     * ⚠️ **実行中のものは数えないこと。** 呼び出し側は自分の実行中に
     * これを見るため、数えると必ず真になって判断できない。
     */
    test('⚠️ 実行中の自分は数えない', async () => {
      const queue = new FieldQueue();
      let seen: boolean | undefined;

      await queue.add('題', () => {
        seen = queue.hasWaiting('題');
        return Promise.resolve();
      });

      expect(seen).toBe(false);
    });

    test('全部終われば無くなる', async () => {
      const queue = new FieldQueue();
      await queue.add('題', () => Promise.resolve());
      expect(queue.hasWaiting('題')).toBe(false);
    });

    test('鍵が違えば影響しない', () => {
      const queue = new FieldQueue();
      const blocker = deferred();
      void queue.add('題', () => blocker.promise);
      void queue.add('題', () => Promise.resolve());

      expect(queue.hasWaiting('ゴミ箱')).toBe(false);
      blocker.resolve();
    });
  });
});
