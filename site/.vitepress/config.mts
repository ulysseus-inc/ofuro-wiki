import { defineConfig } from 'vitepress'

// 見出しの id。VitePress 既定と同じ処理の最後に NFC へ戻す。
// 既定は NFKD のまま返すため、濁点・半濁点（ダ・パ）が分かれた id になり、
// 手で書いたリンク（#_1-フォルダー…）と一致せず、押しても飛ばない
const rControl = /[\u0000-\u001f]/g
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g
const rCombining = /[̀-ͯ]/g
const slugify = (str: string) =>
  str
    .normalize('NFKD')
    .replace(rCombining, '')
    .replace(rControl, '')
    .replace(rSpecial, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase()
    .normalize('NFC')

const GITHUB = 'https://github.com/ulysseus-inc/ofuro-wiki'

// 章を足したら、日本語と英語の両方に足す（無いページへのリンクはビルドで落ちる）
// 英語版は /en/ の下に、日本語版と同じ構成で置く（docs/docs-site.md 4.2）

/** 日本語（既定。/docs/） */
const ja = {
  nav: [
    { text: '導入と運用', link: '/guide/introduction' },
    { text: '使い方', link: '/user/' },
    { text: 'GitHub', link: GITHUB },
  ],

  // 上の帯の「使い方」と「導入と運用」で、サイドバーを分ける
  sidebar: {
    '/user/': [
      {
        text: '使い方',
        items: [
          { text: '目次', link: '/user/' },
          { text: 'はじめに', link: '/user/getting-started' },
          { text: 'ページとブロック', link: '/user/pages-and-blocks' },
          { text: 'エディタの使い方', link: '/user/editor' },
          { text: '便利な機能', link: '/user/features' },
          { text: '共有と権限', link: '/user/sharing' },
          { text: 'スマホで使う', link: '/user/mobile' },
        ],
      },
    ],
    '/guide/': [
      {
        text: 'はじめに',
        items: [
          { text: 'ofuro-wiki とは', link: '/guide/introduction' },
          { text: 'クイックスタート', link: '/guide/quickstart' },
        ],
      },
      {
        text: '導入',
        items: [
          { text: '社内サーバーへの導入', link: '/guide/install-server' },
          { text: '初期設定', link: '/guide/initial-setup' },
          { text: 'ユーザーとアクセス制限', link: '/guide/users-and-access' },
          { text: '運用', link: '/guide/operation' },
          { text: '連携（SSO・AI エージェント）', link: '/guide/integration' },
          { text: '困ったとき', link: '/guide/troubleshooting' },
        ],
      },
      {
        text: '付録',
        items: [
          { text: 'Windows PC で導入する', link: '/guide/install-windows' },
          { text: '社内のドメイン名・認証局を使う', link: '/guide/install-internal-ca' },
        ],
      },
    ],
  },

  outline: { level: [2, 3] as [number, number], label: 'このページの内容' },
  docFooter: { prev: '前へ', next: '次へ' },
  lastUpdated: { text: '更新日' },
  returnToTopLabel: '先頭へ',
  sidebarMenuLabel: 'メニュー',
  darkModeSwitchLabel: '表示',
  langMenuLabel: '言語',
}

/** 英語（/docs/en/） */
const en = {
  nav: [
    { text: 'Install & operate', link: '/en/guide/introduction' },
    { text: 'User guide', link: '/en/user/' },
    { text: 'GitHub', link: GITHUB },
  ],

  sidebar: {
    '/en/user/': [
      {
        text: 'User guide',
        items: [
          { text: 'Contents', link: '/en/user/' },
          { text: 'Getting started', link: '/en/user/getting-started' },
          { text: 'Pages and blocks', link: '/en/user/pages-and-blocks' },
          { text: 'Using the editor', link: '/en/user/editor' },
          { text: 'Handy features', link: '/en/user/features' },
          { text: 'Sharing and permissions', link: '/en/user/sharing' },
          { text: 'On your phone', link: '/en/user/mobile' },
        ],
      },
    ],
    '/en/guide/': [
      {
        text: 'Getting started',
        items: [
          { text: 'What is ofuro-wiki', link: '/en/guide/introduction' },
          { text: 'Quick start', link: '/en/guide/quickstart' },
        ],
      },
      {
        text: 'Install',
        items: [
          { text: 'Install on a server', link: '/en/guide/install-server' },
          { text: 'Initial setup', link: '/en/guide/initial-setup' },
          { text: 'Users and access', link: '/en/guide/users-and-access' },
          { text: 'Operation', link: '/en/guide/operation' },
          { text: 'Integrations (SSO, AI agents)', link: '/en/guide/integration' },
          { text: 'Troubleshooting', link: '/en/guide/troubleshooting' },
        ],
      },
      {
        text: 'Appendix',
        items: [
          { text: 'Install on a Windows PC', link: '/en/guide/install-windows' },
          { text: 'Use your own domain and CA', link: '/en/guide/install-internal-ca' },
        ],
      },
    ],
  },

  outline: { level: [2, 3] as [number, number], label: 'On this page' },
  docFooter: { prev: 'Previous', next: 'Next' },
  lastUpdated: { text: 'Last updated' },
}

export default defineConfig({
  // 本体が /docs/ で配る（docs/docs-site.md 5.1）
  base: '/docs/',
  title: 'ofuro-wiki',
  cleanUrls: true,
  // 手順書で開いてもらう利用者側の URL（http://localhost:3010 等）はリンク切れ扱いしない
  ignoreDeadLinks: 'localhostLinks',
  markdown: { anchor: { slugify } },

  // ブラウザのタブのアイコン（base の /docs/ を付ける）
  head: [['link', { rel: 'icon', type: 'image/png', href: '/docs/favicon.png' }]],

  locales: {
    root: {
      label: '日本語',
      lang: 'ja-JP',
      description: 'ofuro-wiki の使い方と、導入・運用の手順書',
      themeConfig: ja,
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      description: 'How to use, install, and operate ofuro-wiki',
      themeConfig: en,
    },
  },

  themeConfig: {
    // ロゴ。ダークでは浴槽の線を明るくしたものを使う
    logo: { light: '/logo.png', dark: '/logo-dark.png', alt: 'ofuro-wiki' },

    // 手元の検索（外部へ送らない）。言語ごとに索引を分ける
    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: '検索', buttonAriaLabel: '検索' },
              modal: {
                noResultsText: '見つかりません',
                resetButtonTitle: 'クリア',
                footer: { selectText: '選ぶ', navigateText: '移動', closeText: '閉じる' },
              },
            },
          },
        },
      },
    },
  },
})
