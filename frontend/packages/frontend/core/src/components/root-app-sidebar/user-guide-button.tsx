import { MenuItem } from '@ofuro/core/modules/app-sidebar/views';
import { I18nService } from '@ofuro/core/modules/i18n';
import { userGuideUrl } from '@ofuro/core/utils/user-guide';
import { useI18n } from '@ofuro/i18n';
import { HelpIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback } from 'react';

/**
 * #324: 使い方（ガイド）を新しいタブで開く。
 * 以前の「📖 Manual」ワークスペースの代わり（docs/docs-site.md 5.1）
 */
export const UserGuideButton = () => {
  const t = useI18n();
  const i18n = useService(I18nService).i18n;
  const language = useLiveData(i18n.currentLanguageKey$) ?? '';

  const open = useCallback(() => {
    window.open(userGuideUrl(language), '_blank', 'noopener');
  }, [language]);

  return (
    <MenuItem
      data-testid="slider-bar-user-guide-button"
      icon={<HelpIcon />}
      onClick={open}
    >
      {t['com.ofuro.userGuide']()}
    </MenuItem>
  );
};
