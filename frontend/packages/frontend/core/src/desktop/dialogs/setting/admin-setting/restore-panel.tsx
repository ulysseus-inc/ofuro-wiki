import { Button, ConfirmModal, notify } from '@ofuro/component';
import {
  SettingHeader,
  SettingWrapper,
} from '@ofuro/component/setting-components';
import { useI18n } from '@ofuro/i18n';
import { useCallback, useRef, useState } from 'react';

import * as styles from './style.css';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

type RestoreStep =
  | 'idle'
  | 'uploading'
  | 'restoring'
  | 'clearing-cache'
  | 'reloading';

export const RestorePanel = () => {
  const t = useI18n();
  const stepLabels: Record<RestoreStep, string> = {
    idle: '',
    uploading: t['com.affine.admin.restore.step.uploading'](),
    restoring: t['com.affine.admin.restore.step.restoring'](),
    'clearing-cache': t['com.affine.admin.restore.step.clearingCache'](),
    reloading: t['com.affine.admin.restore.step.reloading'](),
  };
  const [file, setFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState<RestoreStep>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  const isRestoring = step !== 'idle';

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0] ?? null;
      setFile(selected);
    },
    []
  );

  const onRestore = useCallback(async () => {
    if (!file) return;
    setConfirming(false);

    try {
      // Step 1: Upload
      setStep('uploading');
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/admin/restore', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ message: res.statusText }));
        throw new Error(body.message || `HTTP ${res.status}`);
      }

      // Step 2: Server restore done
      setStep('restoring');
      // Small delay to show the step visually
      await new Promise((r) => setTimeout(r, 500));

      // Step 3: Clear IndexedDB
      setStep('clearing-cache');
      const databases = await window.indexedDB.databases();
      await Promise.all(
        databases.map(
          (db) =>
            new Promise<void>((resolve) => {
              if (!db.name) return resolve();
              const req = window.indexedDB.deleteDatabase(db.name);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
              req.onblocked = () => resolve();
            })
        )
      );

      // Step 4: Reload
      setStep('reloading');
      window.location.href = '/';
    } catch (e: any) {
      notify.error({
        title: t['com.affine.admin.restore.notify.failed'](),
        message: e.message,
      });
      setStep('idle');
    }
  }, [file, t]);

  return (
    <div className={styles.adminPanel}>
      <SettingHeader
        title={t['com.affine.admin.nav.restore']()}
        subtitle={t['com.affine.admin.restore.subtitle']()}
      />

      <SettingWrapper title={t['com.affine.admin.restore.upload.title']()}>
        <div className={styles.settingItem}>
          <div className={styles.settingLabel}>
            <div className={styles.settingName}>
              {t['com.affine.admin.restore.select.name']()}
            </div>
            <div className={styles.settingDesc}>
              {t['com.affine.admin.restore.select.desc']()}
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".zip"
            onChange={onFileChange}
            style={{ display: 'none' }}
          />
          <Button
            variant="secondary"
            onClick={() => inputRef.current?.click()}
            disabled={isRestoring}
          >
            {t['com.affine.admin.restore.chooseFile']()}
          </Button>
        </div>

        {file && !isRestoring && (
          <div className={styles.settingItem}>
            <div className={styles.settingLabel}>
              <div className={styles.settingName}>{file.name}</div>
              <div className={styles.settingDesc}>
                {formatBytes(file.size)}
              </div>
            </div>
            <Button
              variant="error"
              data-testid="admin-restore-button"
              onClick={() => setConfirming(true)}
            >
              {t['com.affine.admin.nav.restore']()}
            </Button>
          </div>
        )}

        {isRestoring && (
          <div className={styles.restoreProgress}>
            <div className={styles.restoreSpinner} />
            <div className={styles.restoreStepText}>{stepLabels[step]}</div>
          </div>
        )}
      </SettingWrapper>

      <ConfirmModal
        open={confirming}
        onOpenChange={() => setConfirming(false)}
        title={t['com.affine.admin.restore.confirm.title']()}
        description={t['com.affine.admin.restore.confirm.desc']()}
        confirmText={t['com.affine.admin.nav.restore']()}
        confirmButtonOptions={{ variant: 'error' }}
        onConfirm={onRestore}
      />
    </div>
  );
};
