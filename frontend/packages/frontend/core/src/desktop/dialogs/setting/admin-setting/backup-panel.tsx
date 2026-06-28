import { Button, ConfirmModal, notify } from '@ofuro/component';
import { SettingHeader, SettingWrapper } from '@ofuro/component/setting-components';
import { GraphQLService } from '@ofuro/core/modules/cloud';
import { useI18n } from '@ofuro/i18n';
import {
  adminBackupListQuery,
  adminCreateBackupMutation,
  adminDeleteBackupMutation,
  adminServerSettingsQuery,
  adminUpdateServerSettingMutation,
} from '@ofuro/graphql';
import { DeleteIcon, DownloadIcon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import { useCallback, useEffect, useState } from 'react';

import * as styles from './style.css';

interface BackupRecord {
  id: string;
  filename: string;
  size: string;
  workspaceCount: number;
  docCount: number;
  blobCount: number;
  status: string;
  createdAt: string;
}

function formatBytes(bytesStr: string): string {
  const bytes = parseInt(bytesStr, 10);
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

export const BackupPanel = () => {
  const t = useI18n();
  const graphqlService = useService(GraphQLService);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BackupRecord | null>(null);

  // Settings
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [backupSchedule, setBackupSchedule] = useState('daily');
  const [backupRetention, setBackupRetention] = useState('30');

  const fetchBackups = useCallback(async () => {
    setLoading(true);
    try {
      const result = await graphqlService.gql({
        query: adminBackupListQuery,
        variables: { skip: 0, take: 50 },
      } as any);
      setBackups((result as any).adminBackupList.items);
      setTotalCount((result as any).adminBackupList.totalCount);
    } finally {
      setLoading(false);
    }
  }, [graphqlService]);

  const fetchSettings = useCallback(async () => {
    try {
      const result = await graphqlService.gql({
        query: adminServerSettingsQuery,
        variables: {},
      } as any);
      const settings = (result as any).adminServerSettings as Array<{
        key: string;
        value: string;
      }>;
      for (const s of settings) {
        if (s.key === 'backup_enabled') setBackupEnabled(s.value === 'true');
        if (s.key === 'backup_schedule') setBackupSchedule(s.value);
        if (s.key === 'backup_retention_days') setBackupRetention(s.value);
      }
    } catch {
      // Settings may not exist yet
    }
  }, [graphqlService]);

  useEffect(() => {
    fetchBackups();
    fetchSettings();
  }, [fetchBackups, fetchSettings]);

  const updateSetting = useCallback(
    async (key: string, value: string) => {
      try {
        await graphqlService.gql({
          query: adminUpdateServerSettingMutation,
          variables: { key, value },
        } as any);
      } catch (e) {
        console.error('Failed to update setting:', e);
        throw e; // re-throw so callers can handle if needed
      }
    },
    [graphqlService]
  );

  const onToggleEnabled = useCallback(async () => {
    const newValue = !backupEnabled;
    setBackupEnabled(newValue);
    try {
      await updateSetting('backup_enabled', newValue ? 'true' : 'false');
    } catch (e) {
      setBackupEnabled(!newValue); // revert on failure
    }
  }, [backupEnabled, updateSetting]);

  const onScheduleChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      setBackupSchedule(value);
      try {
        await updateSetting('backup_schedule', value);
      } catch (e) {
        console.error('Failed to update backup schedule:', e);
      }
    },
    [updateSetting]
  );

  const onRetentionChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setBackupRetention(value);
      try {
        await updateSetting('backup_retention_days', value);
      } catch (e) {
        console.error('Failed to update backup retention:', e);
      }
    },
    [updateSetting]
  );

  const onCreateBackup = useCallback(async () => {
    setCreating(true);
    try {
      await graphqlService.gql({
        query: adminCreateBackupMutation,
        variables: {},
      } as any);
      notify.success({ title: t['com.affine.admin.backup.notify.created']() });
      await fetchBackups();
    } catch (e: any) {
      notify.error({
        title: t['com.affine.admin.backup.notify.createFailed'](),
        message: e.message,
      });
    } finally {
      setCreating(false);
    }
  }, [graphqlService, fetchBackups, t]);

  const onDeleteBackup = useCallback(
    async (id: string) => {
      try {
        await graphqlService.gql({
          query: adminDeleteBackupMutation,
          variables: { id },
        } as any);
        notify.success({ title: t['com.affine.admin.backup.notify.deleted']() });
        setDeleteTarget(null);
        await fetchBackups();
      } catch (e: any) {
        notify.error({
          title: t['com.affine.admin.backup.notify.deleteFailed'](),
          message: e.message,
        });
      }
    },
    [graphqlService, fetchBackups, t]
  );

  const onDownloadBackup = useCallback((backupId: string) => {
    const url = `/api/admin/backups/${backupId}/download`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  return (
    <div className={styles.adminPanel}>
      <SettingHeader
        title={t['com.affine.admin.nav.backup']()}
        subtitle={t['com.affine.admin.backup.subtitle']()}
      />

      {/* Backup Settings */}
      <SettingWrapper title={t['com.affine.admin.backup.auto.title']()}>
        <div className={styles.settingItem}>
          <div className={styles.settingLabel}>
            <div className={styles.settingName}>
              {t['com.affine.admin.backup.auto.enable.name']()}
            </div>
            <div className={styles.settingDesc}>
              {t['com.affine.admin.backup.auto.enable.desc']()}
            </div>
          </div>
          <Button
            variant={backupEnabled ? 'primary' : 'secondary'}
            onClick={onToggleEnabled}
          >
            {backupEnabled
              ? t['com.affine.admin.backup.enabled']()
              : t['com.affine.admin.backup.disabled']()}
          </Button>
        </div>

        {backupEnabled && (
          <>
            <div className={styles.settingItem}>
              <div className={styles.settingLabel}>
                <div className={styles.settingName}>
                  {t['com.affine.admin.backup.schedule.name']()}
                </div>
                <div className={styles.settingDesc}>
                  {t['com.affine.admin.backup.schedule.desc']()}
                </div>
              </div>
              <select
                className={styles.searchInput}
                style={{ width: 'auto', flex: 'none' }}
                value={backupSchedule}
                onChange={onScheduleChange}
              >
                <option value="daily">
                  {t['com.affine.admin.backup.schedule.daily']()}
                </option>
                <option value="weekly">
                  {t['com.affine.admin.backup.schedule.weekly']()}
                </option>
                <option value="monthly">
                  {t['com.affine.admin.backup.schedule.monthly']()}
                </option>
              </select>
            </div>

            <div className={styles.settingItem}>
              <div className={styles.settingLabel}>
                <div className={styles.settingName}>
                  {t['com.affine.admin.backup.retention.name']()}
                </div>
                <div className={styles.settingDesc}>
                  {t['com.affine.admin.backup.retention.desc']()}
                </div>
              </div>
              <input
                type="number"
                className={styles.searchInput}
                style={{ width: '80px', flex: 'none' }}
                value={backupRetention}
                onChange={onRetentionChange}
                min="1"
                max="365"
              />
            </div>
          </>
        )}
      </SettingWrapper>

      {/* Manual Backup */}
      <SettingWrapper title={t['com.affine.admin.backup.manual.title']()}>
        <div className={styles.settingItem}>
          <div className={styles.settingLabel}>
            <div className={styles.settingName}>
              {t['com.affine.admin.backup.manual.name']()}
            </div>
            <div className={styles.settingDesc}>
              {t['com.affine.admin.backup.manual.desc']()}
            </div>
          </div>
          <Button
            variant="primary"
            data-testid="admin-create-backup"
            onClick={onCreateBackup}
            loading={creating}
            disabled={creating}
          >
            {creating
              ? t['com.affine.admin.backup.creating']()
              : t['com.affine.admin.backup.create']()}
          </Button>
        </div>
      </SettingWrapper>

      {/* Backup List */}
      <SettingWrapper
        title={t['com.affine.admin.backup.history']({
          count: String(totalCount),
        })}
      >
        {backups.length === 0 ? (
          <div className={styles.emptyState}>
            {loading ? t['Loading']() : t['com.affine.admin.backup.empty']()}
          </div>
        ) : (
          <div className={styles.backupTable}>
            {backups.map((backup) => (
              <div key={backup.id} className={styles.backupRow}>
                <div className={styles.backupInfo}>
                  <div className={styles.backupName}>{backup.filename}</div>
                  <div className={styles.backupMeta}>
                    {formatDate(backup.createdAt)} &middot;{' '}
                    {formatBytes(backup.size)} &middot;{' '}
                    {t['com.affine.admin.backup.meta']({
                      count: String(backup.workspaceCount),
                      docs: String(backup.docCount),
                      blobs: String(backup.blobCount),
                    })}
                  </div>
                </div>
                <span
                  className={`${styles.statusBadge} ${
                    backup.status === 'completed'
                      ? styles.statusCompleted
                      : styles.statusFailed
                  }`}
                >
                  {backup.status}
                </span>
                <div className={styles.backupActions}>
                  <Button
                    variant="secondary"
                    onClick={() => onDownloadBackup(backup.id)}
                    prefix={<DownloadIcon />}
                  >
                    {t['com.affine.admin.backup.download']()}
                  </Button>
                  <Button
                    variant="error"
                    onClick={() => setDeleteTarget(backup)}
                    prefix={<DeleteIcon />}
                  >
                    {t['Delete']()}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingWrapper>

      <ConfirmModal
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title={t['com.affine.admin.backup.delete.title']()}
        description={t['com.affine.admin.backup.delete.desc']({
          filename: deleteTarget?.filename ?? '',
        })}
        confirmText={t['Delete']()}
        confirmButtonOptions={{ variant: 'error' }}
        onConfirm={() => deleteTarget && onDeleteBackup(deleteTarget.id)}
      />
    </div>
  );
};
