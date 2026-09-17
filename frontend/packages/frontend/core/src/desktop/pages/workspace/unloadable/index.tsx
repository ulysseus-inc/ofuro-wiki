import { AffineOtherPageLayout } from '@ofuro/component/affine-other-page-layout';
import { Button, notify, useConfirmModal } from '@ofuro/component';
import type { WorkspaceMetadata } from '@ofuro/core/modules/workspace';
import { WorkspacesService } from '@ofuro/core/modules/workspace';
import { useI18n } from '@ofuro/i18n';
import { useService } from '@toeverything/infra';
import { useCallback } from 'react';

import { useAsyncCallback } from '../../../../components/hooks/affine-async-hooks';
import {
  RouteLogic,
  useNavigateHelper,
} from '../../../../components/hooks/use-navigate-helper';
import * as styles from './styles.css';

/**
 * ⚠️ **ロードも同期も終わったのに、ルートドキュメントが `ready` にならなかった**
 * ときに出す画面（#128）。
 *
 * ⚠️ ここに至る前は**スケルトンのまま永久に待っていた**。エラーも出ず、
 * 一覧に載っているので 404 にもならず、**利用者は自力で復旧できなかった**。
 *
 * ⚠️ **原因を断定しないこと。** いま分かっているきっかけは作成の中断だが、
 * `ready` が false になる理由は他にもあり得る。文言も「読み込めませんでした」
 * に留める。詳細は docs/workspace-load-failure.md
 */
export const WorkspaceUnloadable = ({
  meta,
}: {
  meta: WorkspaceMetadata;
}) => {
  const t = useI18n();
  const workspacesService = useService(WorkspacesService);
  const { openConfirmModal } = useConfirmModal();
  const { jumpToIndex } = useNavigateHelper();

  const onReload = useCallback(() => {
    window.location.reload();
  }, []);

  const onDelete = useAsyncCallback(async () => {
    // ⚠️ **開いているワークスペースに依存する経路を使わないこと。**
    // 読み込めていないので辿り着けない。flavour の削除を直接呼ぶ
    await workspacesService
      .deleteWorkspace(meta)
      .then(() => {
        jumpToIndex(RouteLogic.REPLACE);
      })
      .catch(err => {
        console.error('failed to delete unloadable workspace', err);
        notify.error({ title: t['Failed to remove workspace']() });
      });
  }, [jumpToIndex, meta, t, workspacesService]);

  const onDeleteClick = useCallback(() => {
    // ⚠️ 取り返しがつかないので、必ず確かめる
    openConfirmModal({
      title: t['com.ofuro.workspace-unloadable.delete-confirm-title'](),
      description: t['com.ofuro.workspace-unloadable.delete-confirm-hint'](),
      cancelText: t['Cancel'](),
      confirmText: t['Delete'](),
      confirmButtonOptions: { variant: 'error' },
      onConfirm: onDelete,
    });
  }, [onDelete, openConfirmModal, t]);

  return (
    <AffineOtherPageLayout>
      <div className={styles.container} data-testid="workspace-unloadable">
        <div className={styles.title}>
          {t['com.ofuro.workspace-unloadable.title']()}
        </div>
        <div className={styles.hint}>
          {t['com.ofuro.workspace-unloadable.hint']()}
        </div>
        <div className={styles.actions}>
          <Button
            variant="primary"
            size="large"
            onClick={onReload}
            data-testid="workspace-unloadable-reload"
          >
            {t['com.ofuro.workspace-unloadable.reload']()}
          </Button>
          <Button
            size="large"
            onClick={onDeleteClick}
            data-testid="workspace-unloadable-delete"
          >
            {t['com.ofuro.workspace-unloadable.delete']()}
          </Button>
        </div>
      </div>
    </AffineOtherPageLayout>
  );
};
