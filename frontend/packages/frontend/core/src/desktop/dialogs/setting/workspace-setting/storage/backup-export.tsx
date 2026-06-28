import { notify } from '@ofuro/component';
import { SettingRow } from '@ofuro/component/setting-components';
import { Button } from '@ofuro/component/ui/button';
import { useAsyncCallback } from '@ofuro/core/components/hooks/affine-async-hooks';
import { WorkspaceService } from '@ofuro/core/modules/workspace';
import { ExportIcon, ImportIcon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import { useRef, useState } from 'react';

export const BackupExportPanel = () => {
  const workspace = useService(WorkspaceService).workspace;
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const onImportClick = () => {
    fileInputRef.current?.click();
  };

  const onFileSelected = useAsyncCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.name.endsWith('.zip')) {
        notify.error({
          title: 'Invalid file',
          message: 'Please select a .ofuro-backup.zip file',
        });
        return;
      }

      setImporting(true);
      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/workspaces/import', {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });

        if (!res.ok) {
          const error = await res.text();
          throw new Error(error || `Import failed: ${res.status}`);
        }

        const result = await res.json();
        notify.success({
          title: 'Workspace imported successfully',
          message: `Created workspace "${result.name}" with ${result.docCount} docs and ${result.blobCount} blobs`,
        });

        // Reload page to show the new workspace
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } catch (e: any) {
        notify.error({
          title: 'Import failed',
          message: e.message,
        });
      } finally {
        setImporting(false);
        // Reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    []
  );

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
      <SettingRow
        name="Import Workspace"
        desc="Restore a workspace from a backup file. This creates a new workspace."
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          style={{ display: 'none' }}
          onChange={onFileSelected}
        />
        <Button
          data-testid="import-workspace-backup"
          onClick={onImportClick}
          loading={importing}
          disabled={importing}
          prefix={<ImportIcon />}
        >
          Import
        </Button>
      </SettingRow>
    </>
  );
};
