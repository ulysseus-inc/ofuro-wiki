import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * #151: **見せてはいけないものを見せない扱いになっているか。**
 *
 * 判定そのものは `decide.spec.ts` が入出力で固定している。
 * ここはサービス側の扱いを見る。
 *
 * ⚠️ **実行して確かめられない。** `DiscoveryService` を import すると
 * `@toeverything/infra` 全体が読み込まれ、vitest の環境で失敗する
 * （設定モジュールが `debug.enable` を呼ぶ）。
 * そのため**実装の形**を検査する。判定の中身は `decide.spec.ts` が担う。
 */
describe('Discovery Index の安全側の扱い', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../services/discovery.ts'),
    'utf-8'
  );

  /**
   * ⚠️ **「繋がらない」と「拒否された」を区別すること。**
   * 混ぜると、権限を剥奪されてもオンラインのままキャッシュを見せ続ける。
   */
  test('拒否とオフラインを区別している', () => {
    // ⚠️ 見分けの中身は decide.ts の classifyFailure が持つ
    //（判定を1箇所に集める方針。中身は classify-failure.spec.ts が担保）
    expect(source).toContain('classifyFailure(e)');
    // サービス側で独自に判定していないこと
    expect(source).not.toContain('instanceof GraphQLError');
  });

  /** ⚠️ 拒否されたら手元の複製も捨てる。 */
  test('拒否されたらキャッシュを捨てている', () => {
    const idx = source.indexOf("decision === 'fail'");
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 500);
    expect(block).toContain("failure === 'rejected'");
    expect(block).toContain('this.cache.clear(');
  });

  /**
   * ⚠️ **別人向けの結果は返してもいけない。**
   * 保存しないだけでは、呼び出し側がそのまま画面に出す。
   */
  test('別人向けの Snapshot を返さず throw している', () => {
    const idx = source.indexOf('fresh.userId !== userId');
    expect(idx).toBeGreaterThan(-1);
    // ⚠️ 分岐の中だけを見る。範囲を広く取ると、後続の正常系の return を
    // 拾って誤検出する
    const rest = source.slice(idx);
    const block = rest.slice(0, rest.indexOf('\n    }') + 6);

    expect(block).toContain('throw new Error');
    // 返してしまっていないこと
    expect(block).not.toMatch(/return\s*\{\s*entry:\s*fresh/);
  });

  /**
   * ⚠️ **一覧の取得でも拒否されうる。**
   *
   * 版数を取ってから一覧を取るまでの間に権限を剥奪されると、
   * `fetchSnapshot` が拒否される。素通りさせると**古いキャッシュが残り、
   * 次にオフラインになったときそれを見せてしまう**。
   */
  test('一覧の取得が拒否されてもキャッシュを捨てている', () => {
    const idx = source.indexOf('this.store.fetchSnapshot(workspaceId)');
    expect(idx).toBeGreaterThan(-1);
    // その前後（try/catch）に拒否の扱いがあること
    const around = source.slice(Math.max(0, idx - 400), idx + 500);
    expect(around).toContain('classifyFailure(e)');
    expect(around).toContain('this.cache.clear(');
  });

  /**
   * ⚠️ **版数が違うと分かっている場合は、キャッシュを使ってはいけない。**
   *
   * `fetchSnapshot` まで来た時点で**サーバーには到達できている**
   * （版数を取れた＝違うと分かった）。そこで 502 になっても、
   * 古い一覧を見せてよい理由にはならない。
   * オフラインの例外は**到達できないとき**の規定である。
   *
   * 一度ここでキャッシュへ落としており、**権限剥奪の直後に 502 が
   * 起きると隠すべきタイトルをオンラインのまま見せる**状態だった。
   */
  test('一覧の取得が失敗してもキャッシュへ落とさない', () => {
    const idx = source.indexOf('this.store.fetchSnapshot(workspaceId)');
    const around = source.slice(idx, idx + 900);
    expect(around).not.toContain("source: 'offline-cache'");
    expect(around).toContain('throw e;');
  });

  /**
   * ⚠️ **利用者だけでなくワークスペースも照合する。**
   * 別ワークスペースの結果を受け取ると、別の鍵で保存したうえに
   * そのまま画面へ返すことになる。
   */
  test('要求と違うワークスペースの結果を返さない', () => {
    expect(source).toContain('fresh.workspaceId !== workspaceId');
  });

  /** 判定を実装側に書き直していないこと（仕様が散る）。 */
  test('判定は decideDiscoverySource に委ねている', () => {
    expect(source).toContain('decideDiscoverySource({');
    // 版数の比較をサービス側で書いていないこと
    expect(source).not.toMatch(/cached\.revision\s*===\s*serverRevision/);
  });
});

/**
 * ⚠️ **サーバーの応答をそのまま信じない。**
 *
 * `decideDiscoverySource` は `serverRevision === null` を
 * 「サーバーに繋がらない」と解釈する。サーバーが `null` を返したときに
 * 素通りさせると、**オンラインなのに古いキャッシュを使い続ける**。
 */
describe('版数の取得', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../stores/discovery.ts'),
    'utf-8'
  );

  test('版数が文字列でなければ失敗させる', () => {
    expect(source).toContain("typeof revision !== 'string'");
    // ⚠️ **専用の型で投げること。** ただの Error だと呼び出し側の catch が
    // 「通信できない」と同じに扱い、オフライン扱いで古いキャッシュを使う
    expect(source).toContain('throw new InvalidRevisionError()');
  });
});

/**
 * ⚠️ **応答が壊れているときに、オフライン扱いへ逃がさない。**
 *
 * 「繋がらないから古いキャッシュを使う」は通信できないときの例外規定であって、
 * **応答が異常なときの逃げ道ではない**。混ぜると、サーバーが null を返すだけで
 * オンラインなのに古い一覧を使い続ける。
 */
describe('壊れた応答の扱い', () => {
  const service = fs.readFileSync(
    path.join(__dirname, '../services/discovery.ts'),
    'utf-8'
  );

  test('版数が不正なら catch で握りつぶさず投げ返す', () => {
    expect(service).toContain('e instanceof InvalidRevisionError');
    const idx = service.indexOf('e instanceof InvalidRevisionError');
    expect(service.slice(idx, idx + 60)).toContain('throw e');
  });

  test('classifyFailure より前に判定している', () => {
    const invalidAt = service.indexOf('InvalidRevisionError');
    const classifyAt = service.indexOf('classifyFailure(e)');
    expect(invalidAt).toBeGreaterThan(-1);
    expect(invalidAt).toBeLessThan(classifyAt);
  });
});


/**
 * #151 段階3: **作成したページの題が台帳に届くこと**（7.12）。
 *
 * ⚠️ **実行して確かめられない**（上と同じ理由）ので、実装の形を検査する。
 * 実際の動きは `e2e/sync.spec.ts` と、サーバー側の
 * `backend/test/modules/discovery/doc-meta-write.spec.ts` が担う。
 *
 * ## 何が起きていたか（2026-08-31 実測）
 *
 * ```
 * 作成    createDoc → サーバーが版数 1 で採番   ← 応答を捨てていた
 * 題入力  baseRevision 0 で送信
 * サーバー 1 !== 0 → stale
 * 結果    打った題が捨てられ、**新規ページがすべて無題になる**
 * ```
 */
describe('作成したページの題が台帳に届く', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../services/doc-meta-write.ts'),
    'utf-8'
  );

  /**
   * ⚠️ **作成の応答を捨てないこと。** サーバーが採番した版数を控えないと、
   * 直後の書き込みが**構造的に必ず stale になる**。
   */
  test('⚠️ 作成の応答から3フィールドの版数を控えている', () => {
    const idx = source.indexOf('this.store.createDoc(');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 900);

    expect(block).toContain("this.remember(docId, 'title', result.titleRevision)");
    expect(block).toContain("this.remember(docId, 'trash', result.trashRevision)");
    expect(block).toContain("this.remember(docId, 'tags', result.tagsRevision)");
  });

  /**
   * ⚠️ **`revision`（単数）で代用しないこと。** あれは「いま書いた
   * フィールドの版数」で、作成は3つ同時に採番する。
   * 単数を3つに配ると、再送で改名済みのページの trash / tags へ
   * **嘘の版数を書く**。
   */
  test('⚠️ 単数の revision を3フィールドに配っていない', () => {
    const idx = source.indexOf('this.store.createDoc(');
    const block = source.slice(idx, idx + 900);

    expect(block).not.toContain("this.remember(docId, 'trash', result.revision)");
    expect(block).not.toContain("this.remember(docId, 'tags', result.revision)");
  });
});
