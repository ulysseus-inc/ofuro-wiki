import { Button, notify } from '@ofuro/component';
import { useAsyncCallback } from '@ofuro/core/components/hooks/affine-async-hooks';
import { useI18n } from '@ofuro/i18n';
import { ImportIcon } from '@blocksuite/icons/rc';
import { useRef, useState } from 'react';

/** 書き出したファイルの拡張子 */
const BACKUP_SUFFIX = '.zip';

/**
 * #297: 書き出したファイル（.ofuro-backup.zip）から共有ワークスペースを作る。
 * システム管理者だけができるため、ストレージ設定から管理画面へ移した（docs/workspace-model.md 12.6）
 */
export const WorkspaceImportButton = ({
  onImported,
}: {
  onImported: () => void;
}) => {
  const t = useI18n();
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFileSelected = useAsyncCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) {
        return;
      }

      if (!file.name.endsWith(BACKUP_SUFFIX)) {
        notify.error({
          title: t['com.affine.admin.workspaces.import.invalid'](),
        });
        return;
      }

      // 送る: サーバーが新しい共有として作る
      setImporting(true);
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/workspaces/import', {
          method: 'POST',
          credentials: 'include',
          body: form,
        });
        if (!res.ok) {
          throw new Error((await res.text()) || `${res.status}`);
        }

        notify.success({ title: t['com.affine.admin.workspaces.import.done']() });
        onImported();
      } catch (err: any) {
        notify.error({
          title: t['com.affine.admin.workspaces.import.failed'](),
          message: err?.message ?? '',
        });
      } finally {
        setImporting(false);
        // 同じファイルを選び直しても onChange が動くように
        if (inputRef.current) {
          inputRef.current.value = '';
        }
      }
    },
    [onImported, t]
  );

  return (
    <>
      <input
        ref={inputRef}
        data-testid="admin-import-workspace-input"
        type="file"
        accept={BACKUP_SUFFIX}
        style={{ display: 'none' }}
        onChange={onFileSelected}
      />
      <Button
        data-testid="admin-import-workspace"
        prefix={<ImportIcon />}
        loading={importing}
        disabled={importing}
        onClick={() => inputRef.current?.click()}
      >
        {t['com.affine.admin.workspaces.import']()}
      </Button>
    </>
  );
};
