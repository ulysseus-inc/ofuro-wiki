import { Button, ConfirmModal, notify } from '@ofuro/component';
import { SettingHeader, SettingWrapper } from '@ofuro/component/setting-components';
import {
  RouteLogic,
  useNavigateHelper,
} from '@ofuro/core/components/hooks/use-navigate-helper';
import { useWorkspaceName } from '@ofuro/core/components/hooks/use-workspace-info';
import { GraphQLService } from '@ofuro/core/modules/cloud';
import { GlobalDialogService } from '@ofuro/core/modules/dialogs';
import { GlobalContextService } from '@ofuro/core/modules/global-context';
import {
  type WorkspaceMetadata,
  WorkspacesService,
} from '@ofuro/core/modules/workspace';
import {
  adminWorkspaceListQuery,
  type AdminWorkspaceListQuery,
} from '@ofuro/graphql';
import { useI18n } from '@ofuro/i18n';
import { DeleteIcon, PlusIcon } from '@blocksuite/icons/rc';
import { useLiveData, useServices } from '@toeverything/infra';
import { useCallback, useEffect, useState } from 'react';

import * as styles from './style.css';
import { WorkspaceImportButton } from './workspace-import';

/**
 * #297: 管理画面「ワークスペース」。共有ワークスペースの一覧・作成・開く・削除。
 * docs/workspace-model.md 12.8.1
 */
type WorkspaceItem = AdminWorkspaceListQuery['adminWorkspaceList'][number];

interface DeleteTarget {
  item: WorkspaceItem;
  name: string;
}

/**
 * 1 行。名前はサイドバーと同じく、ワークスペースの中（Yjs）から取る。
 * サーバーの workspaces.name は作った時の既定値のままで、使えない
 */
const WorkspaceRow = ({
  item,
  meta,
  onOpen,
  onDelete,
}: {
  item: WorkspaceItem;
  meta: WorkspaceMetadata | undefined;
  onOpen: (id: string) => void;
  onDelete: (target: DeleteTarget) => void;
}) => {
  const t = useI18n();
  const name =
    useWorkspaceName(meta) || t['com.affine.admin.workspaces.untitled']();

  return (
    <div className={styles.backupRow} data-testid="admin-workspace-row">
      <div className={styles.backupInfo}>
        <div className={styles.backupName}>{name}</div>
        <div className={styles.backupMeta}>
          {t['com.affine.admin.workspaces.members']({
            count: String(item.memberCount),
          })}{' '}
          &middot; {new Date(item.updatedAt).toLocaleString()}
        </div>
      </div>
      <div className={styles.backupActions}>
        <Button variant="secondary" onClick={() => onOpen(item.id)}>
          {t['com.affine.admin.workspaces.open']()}
        </Button>
        <Button
          variant="error"
          prefix={<DeleteIcon />}
          onClick={() => onDelete({ item, name })}
        >
          {t['Delete']()}
        </Button>
      </div>
    </div>
  );
};

export const WorkspacePanel = ({
  onCloseSetting,
}: {
  onCloseSetting: () => void;
}) => {
  const t = useI18n();
  const {
    graphQLService,
    globalDialogService,
    globalContextService,
    workspacesService,
  } = useServices({
    GraphQLService,
    GlobalDialogService,
    GlobalContextService,
    WorkspacesService,
  });
  const { jumpToPage, jumpToIndex } = useNavigateHelper();
  const workspaceList = useLiveData(workspacesService.list.workspaces$);
  const currentWorkspaceId = useLiveData(
    globalContextService.globalContext.workspaceId.$
  );
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const result = await graphQLService.gql({
        query: adminWorkspaceListQuery,
      });
      setItems(result.adminWorkspaceList);
    } catch (e: any) {
      notify.error({
        title: t['com.affine.admin.workspaces.notify.loadFailed'](),
        message: e?.message ?? '',
      });
    } finally {
      setLoading(false);
    }
  }, [graphQLService, t]);

  useEffect(() => {
    fetchList().catch(() => {
      // 失敗は fetchList の中で知らせる
    });
  }, [fetchList]);

  // 作成は Ctrl+K と同じダイアログ（12.3）。閉じたら一覧を取り直す
  const onCreate = useCallback(() => {
    globalDialogService.open('create-workspace', {}, () => {
      fetchList().catch(() => {
        // 失敗は fetchList の中で知らせる
      });
    });
  }, [globalDialogService, fetchList]);

  // 取り込んだら一覧を取り直す。名前は手元の一覧（Yjs）から出すため、そちらも更新する
  const onImported = useCallback(() => {
    workspacesService.list.revalidate();
    fetchList().catch(() => {
      // 失敗は fetchList の中で知らせる
    });
  }, [workspacesService, fetchList]);

  const onOpen = useCallback(
    (id: string) => {
      onCloseSetting();
      jumpToPage(id, 'all');
    },
    [onCloseSetting, jumpToPage]
  );

  const onDelete = useCallback(
    async (item: WorkspaceItem) => {
      setDeleteTarget(null);

      // 手元の一覧からも消すため、ワークスペースの仕組み経由で消す。
      // システム管理者の一覧には、すべての共有が載っている（12.8）
      const meta = workspaceList.find(ws => ws.id === item.id);
      if (!meta) {
        notify.error({
          title: t['com.affine.admin.workspaces.notify.deleteFailed'](),
        });
        return;
      }

      // 開いているワークスペースを消すなら、先に着地へ戻す
      if (currentWorkspaceId === item.id) {
        onCloseSetting();
        jumpToIndex(RouteLogic.REPLACE);
      }

      try {
        await workspacesService.deleteWorkspace(meta);
        notify.success({
          title: t['com.affine.admin.workspaces.notify.deleted'](),
        });
        await fetchList();
      } catch (e: any) {
        notify.error({
          title: t['com.affine.admin.workspaces.notify.deleteFailed'](),
          message: e?.message ?? '',
        });
      }
    },
    [
      workspaceList,
      currentWorkspaceId,
      onCloseSetting,
      jumpToIndex,
      workspacesService,
      fetchList,
      t,
    ]
  );

  return (
    <div className={styles.adminPanel}>
      <SettingHeader
        title={t['com.affine.admin.nav.workspaces']()}
        subtitle={t['com.affine.admin.workspaces.subtitle']()}
      />

      <SettingWrapper
        title={t['com.affine.admin.workspaces.list']({
          count: String(items.length),
        })}
      >
        <div className={styles.settingItem}>
          <div className={styles.formActions}>
            <WorkspaceImportButton onImported={onImported} />
            <Button
              variant="primary"
              prefix={<PlusIcon />}
              data-testid="admin-create-workspace"
              onClick={onCreate}
            >
              {t['com.affine.admin.workspaces.create']()}
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className={styles.emptyState}>
            {loading ? t['Loading']() : t['com.affine.admin.workspaces.empty']()}
          </div>
        ) : (
          <div className={styles.backupTable}>
            {items.map(item => (
              <WorkspaceRow
                key={item.id}
                item={item}
                meta={workspaceList.find(ws => ws.id === item.id)}
                onOpen={onOpen}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        )}
      </SettingWrapper>

      <ConfirmModal
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title={t['com.affine.admin.workspaces.delete.title']()}
        description={t['com.affine.admin.workspaces.delete.desc']({
          name: deleteTarget?.name ?? '',
        })}
        confirmText={t['Delete']()}
        cancelText={t['Cancel']()}
        confirmButtonOptions={{ variant: 'error' }}
        onConfirm={() => {
          if (deleteTarget) {
            onDelete(deleteTarget.item).catch(() => {
              // 失敗は onDelete の中で知らせる
            });
          }
        }}
      />
    </div>
  );
};
