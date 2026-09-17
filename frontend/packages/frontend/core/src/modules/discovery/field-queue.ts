/**
 * #151 段階3: **鍵ごとに、積んだ順で1つずつ実行する。**
 *
 * ## ⚠️ なぜ要るのか
 *
 * `DocMetaWriteService.send()` は**待たない**（呼び出し元は Yjs の
 * トランザクション直後にいる）。そのため同じフィールドを続けて編集すると、
 * **呼び出しごとに別の非同期の鎖が走り、応答の順が編集の順と一致しない。**
 *
 * ```
 * 利用者  題を B にする → 題を C にする
 * 送信    B の送信と C の送信が並行に走る
 *         ↓ C が先に失敗し、あとから B が失敗した
 * 控え    C を previous、B を next としてまとめる → **古い B が後勝ち**
 *         ↓ 復帰して再送
 * 結果    利用者の最新の変更 C が B に巻き戻る
 * ```
 *
 * ⚠️ **フィールドごとに分けること。** ドキュメント単位で直列化すると、
 * 遅い題の送信がゴミ箱の送信を待たせる。フィールドどうしは独立している。
 *
 * （`@toeverything/infra` を import したファイルは検査が動かないため、
 * 仕様の中核だけをここに置く。`decide.ts` / `merge-pending.ts` と同じ方針）
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.5.8
 */
export class FieldQueue {
  private readonly tails = new Map<string, Promise<void>>();

  /**
   * 鍵ごとの、**まだ実行していない**仕事の数。
   *
   * ⚠️ サーバーの値を手元へ巻き戻してよいかの判断に要る（3c）。
   * 待っている変更があるのに巻き戻すと、**そのあと送られる新しい値と
   * 画面が食い違ったままになる**（送信は成功するのに画面は古い値）。
   */
  private readonly waitingCounts = new Map<string, number>();

  /**
   * `key` の順番待ちの末尾につなぐ。
   *
   * ⚠️ **前の処理が失敗しても鎖を切らないこと。**
   * 切ると、以降に積まれた分が二度と実行されない。
   */
  add(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    this.waitingCounts.set(key, (this.waitingCounts.get(key) ?? 0) + 1);

    const run = async () => {
      // ⚠️ 実行に入った時点で「待っている」から外す
      const left = (this.waitingCounts.get(key) ?? 1) - 1;
      if (left > 0) this.waitingCounts.set(key, left);
      else this.waitingCounts.delete(key);
      await task();
    };
    const next = previous.then(run, run);

    this.tails.set(key, next);
    void next.then(
      () => this.settle(key, next),
      () => this.settle(key, next)
    );
    return next;
  }

  /** 順番待ちが残っているか（検査・診断用）。 */
  get size(): number {
    return this.tails.size;
  }

  /**
   * その鍵に、**まだ実行していない**仕事が残っているか。
   *
   * ⚠️ 実行中のものは数えない。呼び出し側は自分の実行中に
   * これを見るため、数えると必ず真になって判断できない。
   */
  hasWaiting(key: string): boolean {
    return (this.waitingCounts.get(key) ?? 0) > 0;
  }

  /**
   * ⚠️ **自分が末尾のときだけ片付ける。**
   * 無条件に消すと、実行中にあとから積まれた分を取りこぼし、
   * 次に積んだものが**割り込んで先に走る**。
   */
  private settle(key: string, self: Promise<void>): void {
    if (this.tails.get(key) === self) this.tails.delete(key);
  }
}
