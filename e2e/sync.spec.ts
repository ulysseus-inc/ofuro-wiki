/**
 * 同期の回帰テスト。
 *
 * ## なぜ要るか
 *
 * **#151（Discovery Authorization）は同期層のデータの流れ方を変える。**
 * ワークスペース全体で共有している Yjs の目次を、利用者ごとに絞って配る、
 * という変更になる。
 *
 * ⚠️ **その壊れ方はエラーにならない。**
 *
 * | 壊れ方 | 見え方 |
 * |---|---|
 * | 差分の適用ミス | 目次からページが**静かに消える**（行方不明に見える） |
 * | 書き戻し | 隠したはずの項目が**静かに復活する** |
 * | オフライン復帰時の上書き | 切断中の編集が**消える** |
 *
 * 既存の E2E は「作る・書く・読む」を1つのブラウザで見ているだけで、
 * **2つのクライアントの整合**も**切断からの復帰**も見ていない。
 * この網が無いまま同期層を触ると、**静かなデータ損失に気づけない。**
 *
 * ⚠️ 本番で `workspaces` が消えて本文が回収不能になった事故がある
 * （2026-05-25）。同期層は最も慎重に扱う領域である。
 *
 * 実行方法:
 *   cd e2e && BASE_URL=http://localhost:8080 npx playwright test sync.spec.ts
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { io } from 'socket.io-client';
import * as Y from 'yjs';
import {
  TEST_USER,
  ensureTestUser,
  signIn,
  enterOrCreateWorkspace,
  createNewPage,
  waitForWorkspaceInitialized,
  getOwnedWorkspaceId,
  graphqlQuery,
} from './helpers';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';

test.describe.configure({ mode: 'serial' });

// ⚠️ 2つのブラウザ文脈を起動し、同期の反映を待つため既定の60秒では足りない。
// とくにフロント起動直後（webpack の初回コンパイル後）は遅い。
test.setTimeout(180_000);

test.beforeAll(async () => {
  await ensureTestUser('http://localhost:3010');
});

/** サインイン済みの新しいブラウザ文脈を開く（別の利用者のタブを模す）。 */
async function openClient(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('domcontentloaded', async () => {
    await page
      .addStyleTag({
        content:
          '#webpack-dev-server-client-overlay { pointer-events: none !important; display: none !important; }',
      })
      .catch(() => {});
  });
  await signIn(page);
  await waitForWorkspaceInitialized(page);
  return { page, close: () => context.close() };
}

/** ページ本文に文字を打つ。 */
async function typeIntoDoc(page: Page, text: string) {
  const editor = page.locator('.affine-note-block-container').first();
  await editor.click();
  await page.keyboard.type(text, { delay: 30 });
  // 同期は打鍵のたびに飛ぶ。反映を待つ
  await page.waitForTimeout(1_500);
}

/** 台帳（doc_meta）が持つ更新日時と更新者を GraphQL 経由で読む。 */
async function readUpdated(
  page: Page,
  workspaceId: string,
  docId: string
): Promise<{ updatedAt: string } | null> {
  const res = await page.request.post('/graphql', {
    data: {
      query: `query ($w: String!) {
        discoverySnapshot(workspaceId: $w) { documents { id updatedAt } }
      }`,
      variables: { w: workspaceId },
    },
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await res.json();
  const docs = body?.data?.discoverySnapshot?.documents ?? [];
  return docs.find((d: any) => d.id === docId) ?? null;
}

/** #254: 本文が届く前にエディタが描画を始めないか、見張る時間。 */
const NO_EDITOR_WATCH_MS = 20_000;

/**
 * 別の端末が作ったページ（題・本文あり）を、Yjs の更新として組み立てる。
 *
 * 画面が新規作成で作るのと同じ形（page の下に surface と note、note の下に段落）。
 *
 * ⚠️ BlockSuite の形に手で合わせている（`prop:elements` の Boxed 形式など）。
 * 上流に追従して形が変わると、題とは関係のない理由で落ちる。追従時はここも確認する
 * （本番側の組み立ては backend/src/modules/doc/yjs-doc-builder.ts）。
 */
function buildPageUpdate(title: string, body: string): string {
  const doc = new Y.Doc();
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');

  const addBlock = (
    id: string,
    flavour: string,
    children: string[],
    props: Record<string, unknown>
  ) => {
    const block = new Y.Map<unknown>();
    blocks.set(id, block);
    block.set('sys:id', id);
    block.set('sys:flavour', flavour);
    const ys = new Y.Array<string>();
    ys.push(children);
    block.set('sys:children', ys);
    for (const [key, value] of Object.entries(props)) {
      block.set(key, value);
    }
  };

  // surface の入れ物（BlockSuite の Boxed 形式）
  const elements = new Y.Map<unknown>();
  elements.set('type', '$blocksuite:internal:native$');
  elements.set('value', new Y.Map());

  addBlock('paragraph', 'affine:paragraph', [], {
    'prop:type': 'text',
    'prop:text': new Y.Text(body),
  });
  addBlock('note', 'affine:note', ['paragraph'], {
    'prop:xywh': '[0,0,800,95]',
    'prop:background': '--affine-background-secondary-color',
    'prop:index': 'a0',
    'prop:hidden': false,
    'prop:displayMode': 'both',
  });
  addBlock('surface', 'affine:surface', [], { 'prop:elements': elements });
  addBlock('page', 'affine:page', ['surface', 'note'], {
    'prop:title': new Y.Text(title),
  });

  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
}

/**
 * 同期サーバーへ直接つなぎ、更新を1つ送る。
 *
 * ⚠️ **ブラウザの通信は止められない。** 同期は SharedWorker の中で張られており、
 * Playwright の routeWebSocket はそこに届かない（開発サーバーの通信しか拾わない）。
 * 「本文が遅れて届く」を作るには、届けるほうを自分で握るしかない。
 */
async function pushFromOtherDevice(
  token: string,
  workspaceId: string,
  docId: string,
  update: string
) {
  const socket = io('http://localhost:3010', {
    transports: ['websocket'],
    auth: { token },
  });
  try {
    const space = { spaceType: 'workspace', spaceId: workspaceId };
    const joined = await socket.emitWithAck('space:join', {
      ...space,
      clientVersion: 'e2e',
    });
    expect(joined?.error).toBeUndefined();

    const pushed = await socket.emitWithAck('space:push-doc-update', {
      ...space,
      docId,
      update,
    });
    expect(pushed?.error).toBeUndefined();
  } finally {
    socket.disconnect();
  }
}

test.describe('同期の整合', () => {
  /**
   * ⚠️ **これが基本中の基本なのに、これまで検証していなかった。**
   * 片方の編集がもう片方に届かないと、共同編集が成立しない。
   */
  test('一方の編集が、もう一方のクライアントに届く', async ({ browser }) => {
    const a = await openClient(browser);
    const b = await openClient(browser);

    try {
      await enterOrCreateWorkspace(a.page);
      await createNewPage(a.page);
      await a.page.waitForTimeout(2_000);

      // ⚠️ **先に開いておくこと。** 後から開くと、リアルタイム配信ではなく
      // サーバーからの読み込みで内容が得られてしまい、**配信を検証できない**。
      // 実際、配信を潰してもこのテストが通ってしまう状態だった。
      await b.page.goto(a.page.url());
      await b.page.waitForLoadState('domcontentloaded');
      await b.page.waitForTimeout(3_000);

      // 両方が開いている状態で、片方が編集する
      const marker = `sync-${Date.now()}`;
      await typeIntoDoc(a.page, marker);

      // ⚠️ 固定待機にせず、届くまで待つ（同期は非同期）。
      // **読み込み直さないこと**（直すと配信ではなく読み込みを見てしまう）
      await expect(b.page.locator(`text=${marker}`).first()).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await a.close();
      await b.close();
    }
  });

  /**
   * ⚠️ **切断中の編集が、復帰後に失われないこと。**
   *
   * #151 で目次の配り方を変えると、復帰時にサーバーとクライアントの
   * 認識がずれる。**古い状態を持つクライアントが全体を上書きする**と、
   * その間の編集が消える。
   */
  test('切断中に書いた内容が、復帰後も残る', async ({ browser }) => {
    const client = await openClient(browser);

    try {
      await enterOrCreateWorkspace(client.page);
      await createNewPage(client.page);
      await client.page.waitForTimeout(2_000);

      const before = `before-${Date.now()}`;
      await typeIntoDoc(client.page, before);

      // 通信を止める（切断を模す）
      await client.page.context().setOffline(true);
      await client.page.waitForTimeout(1_000);

      const offline = `offline-${Date.now()}`;
      // ⚠️ 書いた時刻を控える。サーバーの更新日時がこれに追いついたら「届いた」
      const offlineWrittenAt = Date.now();
      await typeIntoDoc(client.page, offline);

      // 復帰
      await client.page.context().setOffline(false);
      await client.page.waitForTimeout(5_000);

      // 画面上は両方残っていること
      await expect(client.page.locator(`text=${before}`).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(client.page.locator(`text=${offline}`).first()).toBeVisible({
        timeout: 15_000,
      });

      // ⚠️ **画面だけでは足りない。** ブラウザの手元に残っているだけで、
      // サーバーへ届いていない可能性がある。
      //
      // ⚠️ **届く前に読み込み直さないこと。** 復帰後の再送がいつ終わるかは
      // 機械の負荷に左右される。固定の待ち時間で読み込み直すと
      // **データが消えていないのに落ち**、読み込みを繰り返すと今度は
      // 未送信のぶんを毎回捨ててしまい**永久に届かない**
      // （2026-09-18 に両方踏んだ）。
      //
      // まずサーバー側の更新日時が進むのを待つ（画面には触らない）。
      const m = client.page.url().match(/\/workspace\/([^/]+)\/([^/?#]+)/);
      expect(m).toBeTruthy();
      const [, wsId, docId] = m as RegExpMatchArray;

      await expect
        .poll(
          async () => {
            const meta = await readUpdated(client.page, wsId, docId);
            return meta ? new Date(meta.updatedAt).getTime() : 0;
          },
          { timeout: 90_000, intervals: [2_000] }
        )
        .toBeGreaterThanOrEqual(offlineWrittenAt);

      // 届いたことを確かめたうえで、読み込み直して本文を見る
      await client.page.reload();
      await client.page.waitForLoadState('domcontentloaded');
      await expect(client.page.locator(`text=${offline}`).first()).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await client.close();
    }
  });

  /**
   * ⚠️ **目次（一覧）そのものが同期されること。**
   *
   * #151 が最も影響するのはここ。一方が作ったページが、
   * もう一方の一覧に現れないと「ページが行方不明」になる。
   */
  test('一方が作ったページが、もう一方の一覧に現れる', async ({ browser }) => {
    const a = await openClient(browser);
    const b = await openClient(browser);

    try {
      await enterOrCreateWorkspace(a.page);
      await createNewPage(a.page);
      await a.page.waitForTimeout(1_500);

      // ⚠️ **題の欄に入ってから打つこと。** 作成直後は編集可能になるまで
      // 一瞬あり、そのまま打つと**先頭の1文字が落ちる**。実際に落ちて
      // 「目次同期-…」が「次同期-…」として保存され、検索に掛からなかった
      // （2026-08-30。アプリの取りこぼしではなく、打鍵が早すぎた）
      // ⚠️ **題の欄を名指しすること。** `[data-block-id] .inline-editor` の
      // 先頭は本文の段落になることがあり、そこへ打つと題が変わらないまま
      // 「同期されていない」と誤診する（2026-08-31 に実際に誤診した）
      const titleBox = a.page.locator('doc-title .inline-editor').first();
      await titleBox.click({ timeout: 30_000 });

      // 新規ページのタイトルを打つ（一覧に出る文字列になる）
      const title = `目次同期-${Date.now()}`;
      await a.page.keyboard.type(title, { delay: 30 });

      // ⚠️ 打った題がそのまま入ったことを先に確かめる。ここを見ないと、
      // 打鍵の取りこぼしを「同期されなかった」と誤診する
      await expect(a.page.locator(`text=${title}`).first()).toBeVisible({
        timeout: 15_000,
      });
      await a.page.waitForTimeout(2_500);

      // もう一方で「すべてのドキュメント」を開く
      await enterOrCreateWorkspace(b.page);
      await b.page.locator('text=すべてのドキュメント').first().click();

      await expect(b.page.locator(`text=${title}`).first()).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await a.close();
      await b.close();
    }
  });
  /**
   * #151 段階3: **本文の編集で更新日時が進み、しかも編集した本人の名義になること。**
   *
   * ⚠️ **これは PR で直した不具合そのもの。** 本文だけを編集すると
   * フロントエンドは台帳を触らないため、更新日時が止まっていた
   * （2026-08-29 実測。台帳 08-27 / 本文 08-29）。サーバー側で
   * 本文の保存と同じトランザクションに入れた（docs 7.10）。
   *
   * もう一方にも同じページを開かせた状態で行う。受信側が押し戻すと
   * 更新日時が二重に動くため、閲覧者がいても壊れないことを併せて見る。
   *
   * ⚠️ **更新者（updatedBy）はここでは検査できない。** 2つの文脈は
   * 同じ利用者でサインインするため、すり替わっても区別がつかない。
   * 「1回の push で台帳の更新は1回」は単体テストで固定している
   * （test/modules/sync/push-update-timestamp.spec.ts）。
   */
  test('本文だけを編集しても更新日時が進む（閲覧者がいても）', async ({
    browser,
  }) => {
    const a = await openClient(browser);
    const b = await openClient(browser);

    try {
      await enterOrCreateWorkspace(a.page);
      await createNewPage(a.page);
      await a.page.waitForTimeout(2_000);
      const title = `鮮度-${Date.now()}`;
      await a.page.keyboard.type(title, { delay: 30 });
      await a.page.waitForTimeout(2_500);

      const docUrl = a.page.url();
      const m = docUrl.match(/\/workspace\/([^/]+)\/([^/?#]+)/);
      expect(m).toBeTruthy();
      const [, wsId, docId] = m as RegExpMatchArray;

      // ⚠️ 相手にも開かせる。閲覧しているだけの状態を作る
      await b.page.goto(docUrl);
      await b.page.waitForLoadState('domcontentloaded');
      await b.page.waitForTimeout(3_000);

      const before = await readUpdated(a.page, wsId, docId);
      expect(before).not.toBeNull();

      // 題ではなく**本文**を打つ（題を打つと台帳が別経路で進んでしまう）
      await a.page.waitForTimeout(1_100); // 同一秒だと差が見えない
      await typeIntoDoc(a.page, `本文-${Date.now()}`);
      await a.page.waitForTimeout(3_000);

      const after = await readUpdated(a.page, wsId, docId);
      expect(after).not.toBeNull();
      expect(new Date(after!.updatedAt).getTime()).toBeGreaterThan(
        new Date(before!.updatedAt).getTime()
      );

    } finally {
      await a.close();
      await b.close();
    }
  });

  /**
   * #254: ⚠️ **初めて使う端末で、本文が届く前にページを開いても、届いたあと題が出ること。**
   *
   * 端末に何も無い状態で開くと、自己修復（ensureRootBlock）が `doc.load()` を呼び、
   * 骨組みが無いまま「骨組みが追加された」通知（空の ID）が出る。エディタがこれを
   * 読み込み完了と取り違え、**題の欄が骨組みの無い状態で置かれて二度と結び直されない**。
   * 本文は届けば描き直されるため、「本文は出るのに題だけ空」になる（2026-09-30 本番）。
   *
   * ⚠️ 開き直すと端末に保存済みの本文で組み立てるので直る。**初回だけ**の不具合。
   *
   * ⚠️ ensureRootBlock は撤去した（効いていなかった）。空の通知はほかの
   * `load()` からも出得るので、エディタ側の「骨組みができるまで待つ」で守っている。
   * 題が出るかだけを見ると、空の通知が出ない限り修正を外しても通ってしまう
   * （2026-10-11 に実測）。そこで「届く前は題の欄を置かない」も確かめる。
   *
   * 台帳にだけ載せて中身を持たないページを開き、そのあと別の端末からの更新として
   * 中身を届ける。これで「本文が届く前に開いた」状態を毎回作れる。
   */
  test('初めての端末で本文より先に開いても、届いたあと題が出る', async ({ browser }) => {
    const b = await openClient(browser);

    try {
      await enterOrCreateWorkspace(b.page);
      const wsId = await getOwnedWorkspaceId(b.page);
      expect(wsId).toBeTruthy();

      // 一覧には載っているが、中身はまだどこにも無いページ
      const docId = `first-open-${Date.now()}`;
      const title = `初めて開く題-${Date.now()}`;
      await graphqlQuery(
        b.page,
        `mutation ($w: String!, $d: String!, $t: String) {
          createDocMeta(workspaceId: $w, docId: $d, title: $t) { status }
        }`,
        { w: wsId, d: docId, t: title }
      );

      await b.page.goto(`/workspace/${wsId}/${docId}`);

      // ⚠️ **本文が届く前は、題の欄（エディタ）を置かないこと。** これが修正の本体。
      // 骨組みが無いのに描画を始めると、題の欄は骨組みの無いまま固まる。
      // 一覧の題が見出しに出る（＝ページの画面までは来た）のを待ってから、
      // しばらく見張る。⚠️ 一瞬だけ見ると、端末内の読み込みが遅い回は
      // 誤って描画する前に見終わってしまい、修正前でも通る（5秒では3回中1回すり抜けた）
      await expect(b.page.locator(`text=${title}`).first()).toBeVisible({
        timeout: 30_000,
      });
      for (let waited = 0; waited < NO_EDITOR_WATCH_MS; waited += 500) {
        expect(await b.page.locator('doc-title').count()).toBe(0);
        await b.page.waitForTimeout(500);
      }

      const token = (await b.page.context().cookies()).find(
        c => c.name === 'affine_token'
      )?.value;
      expect(token).toBeTruthy();
      const body = `後から届いた本文-${Date.now()}`;
      await pushFromOtherDevice(token!, wsId!, docId, buildPageUpdate(title, body));

      // 本文が出ることを先に確かめる（届いていないのを「題が出ない」と誤診しない）
      await expect(b.page.locator(`text=${body}`).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(b.page.locator('doc-title').first()).toContainText(title, {
        timeout: 10_000,
      });
    } finally {
      await b.close();
    }
  });
});
