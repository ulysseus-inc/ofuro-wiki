import en from './en.json' with { type: 'json' };

export type Language = 'en' | 'ja';

export type LanguageResource = typeof en;
export const SUPPORTED_LANGUAGES: Record<
  Language,
  {
    name: string;
    originalName: string;
    flagEmoji: string;
    resource:
      | LanguageResource
      | (() => Promise<{ default: Partial<LanguageResource> }>);
  }
> = {
  en: {
    name: 'English',
    originalName: 'English',
    flagEmoji: '🇬🇧',
    resource: en,
  },
  ja: {
    name: 'Japanese',
    originalName: '日本語',
    flagEmoji: '🇯🇵',
    resource: () => import('./ja.json'),
  },
};
