import { useI18n } from '@ofuro/i18n';
import { WorkbenchLink, WorkbenchService } from '@ofuro/core/modules/workbench';
import { useLiveData, useService } from '@toeverything/infra';

import * as styles from './style.css';

interface Tab {
  to: string;
  /** #105: 画面に英語が直接書かれていたので、翻訳のキーを持たせる */
  labelKey:
    | 'com.affine.m.all-docs.tab.docs'
    | 'com.affine.m.all-docs.tab.collections'
    | 'com.affine.m.all-docs.tab.tags';
}

const tabs: Tab[] = [
  {
    to: '/all',
    labelKey: 'com.affine.m.all-docs.tab.docs',
  },
  {
    to: '/collection',
    labelKey: 'com.affine.m.all-docs.tab.collections',
  },
  {
    to: '/tag',
    labelKey: 'com.affine.m.all-docs.tab.tags',
  },
];

export const AllDocsTabs = () => {
  const workbench = useService(WorkbenchService).workbench;
  const t = useI18n();
  const location = useLiveData(workbench.location$);

  return (
    <ul className={styles.tabs}>
      {tabs.map(tab => {
        return (
          <WorkbenchLink
            data-active={location.pathname === tab.to}
            replaceHistory
            className={styles.tab}
            key={tab.to}
            to={tab.to}
          >
            {t[tab.labelKey]()}
          </WorkbenchLink>
        );
      })}
    </ul>
  );
};
