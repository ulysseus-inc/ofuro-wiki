import { test, expect, type Page } from '@playwright/test';
import {
  createNewPage,
  dismissDevOverlay,
  getOwnedWorkspaceId,
  waitForWorkspaceInitialized,
} from './helpers';

/**
 * #217: **本文で @ からメンバーを選ぶと、メンションが残り、相手に通知が届くこと。**
 *
 * 以前は通知を送ったあと、メンションの属性に「通知済みの印」（`mention.notification`）を
 * 書き込もうとしていた。バックエンドは通知の ID ではなく `true` を返し、BlockSuite の
 * 検査（`notification: z.string()` + `.catch(undefined)`）で捨てられ、**一度も書かれて
 * いなかった**。読む側も無いため、書く処理ごと消した（docs/mention-notification.md）。
 *
 * ⚠️ 動きを変えない削除なので、「修正前に落ちるテスト」は作れない。
 * 削除のあとも、メンションが消えず、通知が作られることを確かめる。
 * これまで、メンバーのメンションを画面から入れる E2E は無かった。
 */

const API = process.env.API_URL || 'http://localhost:3010';

/** メンションする人（ブラウザで操作する） */
const AUTHOR = {
  email: 'e2e-mention-author@ofuro-wiki.local',
  password: 'E2eMentionAuthor123!',
};
/** メンションされる人。@ のメニューには表示名で出るため、準備で名前を付ける */
const TARGET = {
  email: 'e2e-mention-target@ofuro-wiki.local',
  password: 'E2eMentionTarget123!',
  name: 'e2e217target',
};

/** sign-in（無ければ sign-up）して認証クッキーヘッダを返す */
async function authCookie(email: string, password: string): Promise<string> {
  let res = await fetch(`${API}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status === 401 || res.status === 404) {
    res = await fetch(`${API}/api/auth/sign-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  }
  if (!res.ok) {
    throw new Error(`auth failed for ${email}: ${res.status} ${await res.text()}`);
  }
  const cookies = res.headers.getSetCookie?.() ?? [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function gql(cookie: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  expect(json.errors, JSON.stringify(json.errors)).toBeUndefined();
  return json.data;
}

/** ブラウザで指定のユーザーとしてサインインし、自分のワークスペース（無ければ作られる）を開く */
async function openOwnWorkspaceAs(page: Page, user: typeof AUTHOR) {
  const res = await page.request.post('/api/auth/sign-in', {
    data: { email: user.email, password: user.password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok()).toBe(true);

  await page.goto('/');
  await page.waitForURL(/\/workspace\//, { timeout: 30_000 });
  await dismissDevOverlay(page);
  // ⚠️ 中身の書き込みが終わるまで待つ。途中で離れると中身の無いワークスペースが残る
  await waitForWorkspaceInitialized(page);
}

/** 相手に届いた Mention 通知の件数 */
async function mentionCount(cookie: string): Promise<number> {
  const data = await gql(
    cookie,
    `{ currentUser { notifications(pagination: { first: 50 }) { edges { node { type read } } } } }`,
  );
  return data.currentUser.notifications.edges.filter(
    (e: { node: { type: string; read: boolean } }) => e.node.type === 'Mention' && !e.node.read,
  ).length;
}

test.describe('メンバーのメンション（#217）', () => {
  test('⚠️ @ からメンバーを選ぶと、メンションが本文に残り、相手に通知が届く', async ({ page }) => {
    const authorCookie = await authCookie(AUTHOR.email, AUTHOR.password);
    const targetCookie = await authCookie(TARGET.email, TARGET.password);

    // --- 準備: メンションされる人に、@ のメニューで探せる名前を付ける
    const targetId: string = (await gql(targetCookie, `{ currentUser { id } }`)).currentUser.id;
    await gql(
      targetCookie,
      `mutation ($input: UpdateUserInput!) { updateProfile(input: $input) { id } }`,
      { input: { name: TARGET.name } },
    );

    // --- 準備: メンションする人のワークスペース（画面で作らせる。API では中身が作られない）
    await openOwnWorkspaceAs(page, AUTHOR);
    const wsId = await getOwnedWorkspaceId(page);
    expect(wsId).toBeTruthy();
    if (!wsId) {
      return;
    }

    try {
      // --- 準備: メンションされる人を参加させ、既存の通知を既読にしておく
      const invited = await gql(
        authorCookie,
        `mutation ($w: String!, $e: [String!]!) { inviteMembers(workspaceId: $w, emails: $e) { inviteId } }`,
        { w: wsId, e: [TARGET.email] },
      );
      await gql(
        targetCookie,
        `mutation ($w: String!, $i: String!) { acceptInviteById(workspaceId: $w, inviteId: $i) }`,
        { w: wsId, i: invited.inviteMembers[0].inviteId },
      );
      await gql(targetCookie, `mutation { readAllNotifications }`);
      expect(await mentionCount(targetCookie)).toBe(0);

      // --- 画面: 新しいページの本文で @ からメンバーを選ぶ
      // 参加者を読み込み直すため、開き直す
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForWorkspaceInitialized(page);
      await createNewPage(page);
      await page.locator('[data-block-id] .inline-editor').first().click();
      await page.keyboard.press('@');
      await page.keyboard.type(TARGET.name);

      // ⚠️ 名前の文字で選ばないこと。打ち込んだ文字で「新しいページを作る」候補も出て、
      // そちらを押すとメンションではなくページへのリンクが入る（実際にそうなった）。
      // メンバーの候補は key＝メンバーの ID を data-id に持つ（linked-doc-popover.ts）。
      // メンバーの検索は非同期なので、候補が出るまで待つ
      const candidate = page.locator(
        `affine-linked-doc-popover icon-button[data-id="${targetId}"]`,
      );
      await expect(candidate).toBeVisible({ timeout: 30_000 });
      await candidate.click();

      // --- 結果: メンションが本文に入り、相手に通知が届く
      const mention = page.locator('affine-mention').first();
      await expect(mention).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => mentionCount(targetCookie), { timeout: 15_000 }).toBe(1);

      // ⚠️ 通知の処理が終わったあとも、メンションは消えない
      await page.waitForTimeout(2_000);
      await expect(mention).toBeVisible();
      await expect(mention).toContainText(TARGET.name);
    } finally {
      // 後片付け: ワークスペースごと消す（通知も消える）
      await gql(authorCookie, `mutation ($id: String!) { deleteWorkspace(id: $id) }`, { id: wsId });
    }
  });
});

/**
 * #220: ⚠️ **`@` を押しただけ（文字を打たない）でも、自分以外のメンバーが候補に出ること。**
 *
 * 以前は、打ち込んだ文字が無いとメンバーを一度も読み込まず、「メンバーをメンション」に
 * 自分と「Invite…」しか出なかった。ほかのメンバーを選ぶには名前を打つしかなかった
 * （2026-09-13 ユーザーが開発環境で確認）。
 */
test.describe('@ だけのメンバーの候補（#220）', () => {
  test('⚠️ @ を押しただけで、自分以外のメンバーが候補に出る', async ({ page }) => {
    const authorCookie = await authCookie(AUTHOR.email, AUTHOR.password);
    const targetCookie = await authCookie(TARGET.email, TARGET.password);
    const targetId: string = (await gql(targetCookie, `{ currentUser { id } }`)).currentUser.id;

    // --- 準備: メンションする人のワークスペースに、相手を参加させる
    await openOwnWorkspaceAs(page, AUTHOR);
    const wsId = await getOwnedWorkspaceId(page);
    expect(wsId).toBeTruthy();
    if (!wsId) {
      return;
    }

    try {
      const invited = await gql(
        authorCookie,
        `mutation ($w: String!, $e: [String!]!) { inviteMembers(workspaceId: $w, emails: $e) { inviteId } }`,
        { w: wsId, e: [TARGET.email] },
      );
      await gql(
        targetCookie,
        `mutation ($w: String!, $i: String!) { acceptInviteById(workspaceId: $w, inviteId: $i) }`,
        { w: wsId, i: invited.inviteMembers[0].inviteId },
      );

      // --- 画面: 新しいページの本文で @ を押すだけ（文字は打たない）
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForWorkspaceInitialized(page);
      await createNewPage(page);
      await page.locator('[data-block-id] .inline-editor').first().click();
      await page.keyboard.press('@');

      // --- 結果: 相手の候補が出る（候補は data-id にメンバーの ID を持つ）
      await expect(
        page.locator(`affine-linked-doc-popover icon-button[data-id="${targetId}"]`),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await gql(authorCookie, `mutation ($id: String!) { deleteWorkspace(id: $id) }`, { id: wsId });
    }
  });
});

/** ワークスペースの外の人（参加させない） */
const OUTSIDER = {
  email: 'e2e-mention-outsider@ofuro-wiki.local',
  password: 'E2eMentionOutsider123!',
};

/** GraphQL のエラーも含めて返す（拒否を確かめるため） */
async function gqlRaw(cookie: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const MENTION_USER = `mutation ($input: MentionInput!) { mentionUser(input: $input) }`;

/**
 * #223: ⚠️ **メンションは、同じワークスペースのメンバーで、ページを読める人の間だけ。**
 *
 * 以前は `mentionUser` がログインしているかしか見ておらず、API を直接呼べば誰でも、
 * 任意のユーザーにタイトルを偽った通知を送れた。`@` のメニューの「Invite…」も消した
 * （docs/mention-notification.md）。
 */
test.describe('メンションできる相手（#223）', () => {
  test('⚠️ @ のメニューに「Invite…」が出ない（Owner でも）', async ({ page }) => {
    const authorCookie = await authCookie(AUTHOR.email, AUTHOR.password);
    const targetCookie = await authCookie(TARGET.email, TARGET.password);
    const targetId: string = (await gql(targetCookie, `{ currentUser { id } }`)).currentUser.id;

    await openOwnWorkspaceAs(page, AUTHOR);
    const wsId = await getOwnedWorkspaceId(page);
    expect(wsId).toBeTruthy();
    if (!wsId) {
      return;
    }

    try {
      const invited = await gql(
        authorCookie,
        `mutation ($w: String!, $e: [String!]!) { inviteMembers(workspaceId: $w, emails: $e) { inviteId } }`,
        { w: wsId, e: [TARGET.email] },
      );
      await gql(
        targetCookie,
        `mutation ($w: String!, $i: String!) { acceptInviteById(workspaceId: $w, inviteId: $i) }`,
        { w: wsId, i: invited.inviteMembers[0].inviteId },
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForWorkspaceInitialized(page);
      await createNewPage(page);
      await page.locator('[data-block-id] .inline-editor').first().click();
      await page.keyboard.press('@');

      // 候補が出そろってから、「Invite…」（key＝data-id が invite）が無いことを見る
      const popover = page.locator('affine-linked-doc-popover');
      await expect(popover.locator(`icon-button[data-id="${targetId}"]`)).toBeVisible({
        timeout: 15_000,
      });
      await expect(popover.locator('icon-button[data-id="invite"]')).toHaveCount(0);
    } finally {
      await gql(authorCookie, `mutation ($id: String!) { deleteWorkspace(id: $id) }`, { id: wsId });
    }
  });

  test('⚠️ 外の人は送れず、外の人には送れず、題は偽れない（API）', async ({ page }) => {
    const authorCookie = await authCookie(AUTHOR.email, AUTHOR.password);
    const targetCookie = await authCookie(TARGET.email, TARGET.password);
    const outsiderCookie = await authCookie(OUTSIDER.email, OUTSIDER.password);
    const targetId: string = (await gql(targetCookie, `{ currentUser { id } }`)).currentUser.id;
    const outsiderId: string = (await gql(outsiderCookie, `{ currentUser { id } }`)).currentUser
      .id;

    await openOwnWorkspaceAs(page, AUTHOR);
    const wsId = await getOwnedWorkspaceId(page);
    expect(wsId).toBeTruthy();
    if (!wsId) {
      return;
    }

    try {
      // --- 準備: 相手を参加させ、題の付いたページを画面で作る（台帳に題が載る）
      const invited = await gql(
        authorCookie,
        `mutation ($w: String!, $e: [String!]!) { inviteMembers(workspaceId: $w, emails: $e) { inviteId } }`,
        { w: wsId, e: [TARGET.email] },
      );
      await gql(
        targetCookie,
        `mutation ($w: String!, $i: String!) { acceptInviteById(workspaceId: $w, inviteId: $i) }`,
        { w: wsId, i: invited.inviteMembers[0].inviteId },
      );
      await gql(targetCookie, `mutation { readAllNotifications }`);

      const realTitle = `e2e223 本当の題 ${Date.now()}`;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForWorkspaceInitialized(page);
      await createNewPage(page);
      await expect(page.locator('[data-block-is-title]')).toBeVisible({ timeout: 10_000 });
      await page.locator('[data-block-is-title]').click();
      await page.keyboard.type(realTitle);
      const docId = page.url().split('/').pop()!.split('?')[0];

      const input = (userId: string) => ({
        input: { userId, workspaceId: wsId, doc: { id: docId, title: '偽の題', mode: 'page' } },
      });

      // --- 外の人は送れない
      const byOutsider = await gqlRaw(outsiderCookie, MENTION_USER, input(targetId));
      expect(byOutsider.errors, JSON.stringify(byOutsider)).toBeDefined();

      // --- 外の人には送れない（画面が「通知されません」と出す名前で返る）
      const toOutsider = await gqlRaw(authorCookie, MENTION_USER, input(outsiderId));
      expect(toOutsider.errors?.[0]?.extensions?.name, JSON.stringify(toOutsider)).toBe(
        'MENTION_USER_DOC_ACCESS_DENIED',
      );

      // --- 偽の題を送っても、通知には台帳の題が載る
      // ⚠️ 題が台帳へ書かれるのは非同期なので、届いた題が本当の題になるまで送り直す
      await expect
        .poll(
          async () => {
            await gql(targetCookie, `mutation { readAllNotifications }`);
            await gql(authorCookie, MENTION_USER, input(targetId));
            const data = await gql(
              targetCookie,
              `{ currentUser { notifications(pagination: { first: 50 }) { edges { node { type read body } } } } }`,
            );
            const latest = data.currentUser.notifications.edges.find(
              (e: { node: { type: string; read: boolean } }) =>
                e.node.type === 'Mention' && !e.node.read,
            );
            return latest?.node.body?.doc?.title;
          },
          { timeout: 20_000, intervals: [2_000] },
        )
        .toBe(realTitle);
    } finally {
      await gql(authorCookie, `mutation ($id: String!) { deleteWorkspace(id: $id) }`, { id: wsId });
    }
  });
});
