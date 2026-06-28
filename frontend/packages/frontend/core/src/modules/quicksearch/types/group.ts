import type { I18nString } from '@ofuro/i18n';

export interface QuickSearchGroup {
  id: string;
  label: I18nString;
  score?: number;
}
