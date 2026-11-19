import { notify } from '@ofuro/component';
import { SettingRow } from '@ofuro/component/setting-components';
import { Button } from '@ofuro/component/ui/button';
import { useAsyncCallback } from '@ofuro/core/components/hooks/affine-async-hooks';
import { WorkspaceService } from '@ofuro/core/modules/workspace';
import { ExportIcon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import { useState } from 'react';

// #297: 取り込みは管理画面「ワークスペース」へ移した（docs/workspace-model.md 12.6）
export const BackupExportPanel = () => {
  const workspace = useService(WorkspaceService).workspace;
  const [exporting, setExporting] = useState(false);

  const onExport = useAsyncCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await fetch(
        `/api/workspaces/${workspace.id}/export`,
        {
          method: 'POST',
          credentials: 'include',
        }
      );

      if (!res.ok) {
        const error = await res.text();
        throw new Error(error || `Export failed: ${res.status}`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition');
      let filename = `${workspace.name$.getValue() || 'workspace'}.ofuro-backup.zip`;
      if (disposition) {
        const match = disposition.match(/filename="?(.+?)"?$/);
        if (match) filename = decodeURIComponent(match[1]);
      }

      // Download the file
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      notify.success({ title: 'Workspace exported successfully' });
    } catch (e: any) {
      notify.error({
        title: 'Export failed',
        message: e.message,
      });
    } finally {
      setExporting(false);
    }
  }, [exporting, workspace]);

  return (
    <>
      <SettingRow
        name="Export Workspace"
        desc="Download all documents and assets as a backup file (.ofuro-backup.zip)"
      >
        <Button
          variant="primary"
          data-testid="export-workspace-backup"
          onClick={onExport}
          loading={exporting}
          disabled={exporting}
          prefix={<ExportIcon />}
        >
          Export
        </Button>
      </SettingRow>
    </>
  );
};
