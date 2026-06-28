import { NotificationCountService } from '@ofuro/core/modules/notification';
import { WorkbenchService } from '@ofuro/core/modules/workbench';
import { useLiveData, useService } from '@toeverything/infra';
import { useEffect } from 'react';

export const DocumentTitle = () => {
  const notificationCountService = useService(NotificationCountService);
  const notificationCount = useLiveData(notificationCountService.count$);
  const workbenchService = useService(WorkbenchService);
  const workbenchView = useLiveData(workbenchService.workbench.activeView$);
  const viewTitle = useLiveData(workbenchView.title$);

  useEffect(() => {
    const prefix = notificationCount > 0 ? `(${notificationCount}) ` : '';
    document.title = prefix + (viewTitle ? `${viewTitle} · ofuro-wiki` : 'ofuro-wiki');

    return () => {
      document.title = 'ofuro-wiki';
    };
  }, [notificationCount, viewTitle]);

  return null;
};
