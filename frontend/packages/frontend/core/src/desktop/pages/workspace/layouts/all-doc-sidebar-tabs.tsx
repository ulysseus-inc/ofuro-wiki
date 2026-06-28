import { Scrollable } from '@ofuro/component';
import { ViewSidebarTab } from '@ofuro/core/modules/workbench';
import { TodayIcon } from '@blocksuite/icons/rc';

import { sidebarScrollArea } from '../detail-page/detail-page.css';
import { EditorJournalPanel } from '../detail-page/tabs/journal';

export const AllDocSidebarTabs = () => {
  return (
    <ViewSidebarTab tabId="all-docs-journal" icon={<TodayIcon />}>
      <Scrollable.Root className={sidebarScrollArea}>
        <Scrollable.Viewport>
          <EditorJournalPanel />
        </Scrollable.Viewport>
        <Scrollable.Scrollbar />
      </Scrollable.Root>
    </ViewSidebarTab>
  );
};
