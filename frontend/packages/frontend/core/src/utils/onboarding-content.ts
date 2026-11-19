/** 見本の言語 */
export type OnboardingLocale = 'ja' | 'en';

/** 新しいワークスペースに入れる見本の、言語ごとの中身 */
export interface OnboardingContent {
  locale: OnboardingLocale;
  /** 最初に開くページの題（zip の中の題と一致させる） */
  introTitle: string;
  /** フォルダの説明のページの題（zip の中の題と一致させる） */
  folderGuideTitle: string;
  /** 最初に作るフォルダの名前 */
  folderName: string;
}

const JAPANESE = 'ja';

const CONTENTS: Record<OnboardingLocale, OnboardingContent> = {
  ja: {
    locale: 'ja',
    introTitle: 'はじめに',
    folderGuideTitle: 'フォルダとタグの使い方',
    folderName: 'はじめてのフォルダ',
  },
  en: {
    locale: 'en',
    introTitle: 'Getting Started',
    folderGuideTitle: 'How to Use Folders and Tags',
    folderName: 'First Folder',
  },
};

/**
 * 画面の言語に合う見本。日本語なら日本語版、それ以外は英語版（docs/first-workspace.md）。
 *
 * 例: onboardingContent('ja').introTitle → 'はじめに'、onboardingContent('fr').locale → 'en'
 */
export function onboardingContent(language: string): OnboardingContent {
  return CONTENTS[language.startsWith(JAPANESE) ? 'ja' : 'en'];
}
