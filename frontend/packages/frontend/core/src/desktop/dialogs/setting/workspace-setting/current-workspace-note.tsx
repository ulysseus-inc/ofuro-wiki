import { useWorkspaceName } from '@ofuro/core/components/hooks/use-workspace-info';
import { WorkspaceService } from '@ofuro/core/modules/workspace';
import { useI18n } from '@ofuro/i18n';
import { useService } from '@toeverything/infra';

import * as styles from './current-workspace-note.css';

/**
 * #297: 設定の「ワークスペース」が、どのワークスペースの設定かを示す。
 * 設定の中でワークスペースは選び直せないため、切り替え方も添える（docs/workspace-model.md 12.8.2）
 */
export const CurrentWorkspaceNote = () => {
  const t = useI18n();
  const workspace = useService(WorkspaceService).workspace;
  const name =
    useWorkspaceName(workspace.meta) ||
    t['com.affine.admin.workspaces.untitled']();

  return (
    <div className={styles.note} data-testid="current-workspace-note">
      <div className={styles.current}>
        {t['com.ofuro.settings.workspace.current']({ name })}
      </div>
      <div className={styles.hint}>
        {t['com.ofuro.settings.workspace.switch-hint']()}
      </div>
    </div>
  );
};
