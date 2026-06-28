import { SettingRow } from '@ofuro/component/setting-components';
import { useI18n } from '@ofuro/i18n';

import * as styles from './style.css';

export const WorkspaceQuotaPanel = () => {
  const t = useI18n();

  return (
    <SettingRow
      name={t['com.affine.workspace.storage']()}
      desc=""
      spreadCol={false}
    >
      <StorageProgress />
    </SettingRow>
  );
};

export const StorageProgress = () => {
  // Quota service removed in ofuro-wiki - no storage limits
  return (
    <div className={styles.storageProgressContainer}>
      <div className={styles.storageProgressWrapper}>
        <div className="storage-progress-desc">
          <span>Unlimited</span>
        </div>
      </div>
    </div>
  );
};
