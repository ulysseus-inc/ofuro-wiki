import { useI18n } from '@ofuro/i18n';
import { DocDisplayMetaService } from '@ofuro/core/modules/doc-display-meta';
import { JournalService } from '@ofuro/core/modules/journal';
import { WorkbenchService } from '@ofuro/core/modules/workbench';
import { TodayIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback } from 'react';

import { TabItem } from './tab-item';
import type { AppTabCustomFCProps } from './type';

export const AppTabJournal = ({ tab }: AppTabCustomFCProps) => {
  const workbench = useService(WorkbenchService).workbench;
  const t = useI18n();
  const location = useLiveData(workbench.location$);
  const journalService = useService(JournalService);
  const docDisplayMetaService = useService(DocDisplayMetaService);

  const maybeDocId = location.pathname.split('/')[1];
  const journalDate = useLiveData(journalService.journalDate$(maybeDocId));
  const JournalIcon = useLiveData(docDisplayMetaService.icon$(maybeDocId));

  const handleOpenToday = useCallback(() => {
    workbench.open('/journals', { at: 'active' });
  }, [workbench]);

  const Icon = journalDate ? JournalIcon : TodayIcon;

  return (
    <TabItem
      onClick={handleOpenToday}
      id={tab.key}
      label={t['com.affine.journal.app-sidebar-title']()}
    >
      <Icon />
    </TabItem>
  );
};
