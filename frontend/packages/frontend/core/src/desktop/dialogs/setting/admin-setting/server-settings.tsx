import { Button, Switch } from '@ofuro/component';
import { SettingHeader, SettingWrapper } from '@ofuro/component/setting-components';
import { GraphQLService } from '@ofuro/core/modules/cloud';
import { useI18n } from '@ofuro/i18n';
import {
  adminServerSettingsQuery,
  adminUpdateServerSettingMutation,
} from '@ofuro/graphql';
import { useService } from '@toeverything/infra';
import { useCallback, useEffect, useState } from 'react';

import { SsoSettings } from './sso-settings';
import * as styles from './style.css';

interface ServerSetting {
  key: string;
  value: string;
  updatedAt: string;
}

export const ServerSettings = () => {
  const t = useI18n();
  const graphqlService = useService(GraphQLService);
  const [settings, setSettings] = useState<ServerSetting[]>([]);
  const fetchSettings = useCallback(async () => {
    try {
      const result = await graphqlService.gql({
        query: adminServerSettingsQuery,
        variables: {},
      } as any);
      setSettings((result as any).adminServerSettings);
    } catch (e) {
      console.error('Failed to fetch server settings:', e);
    }
  }, [graphqlService]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const getSettingValue = useCallback(
    (key: string): string | undefined => {
      return settings.find(s => s.key === key)?.value;
    },
    [settings]
  );

  const updateSetting = useCallback(
    async (key: string, value: string) => {
      try {
        await graphqlService.gql({
          query: adminUpdateServerSettingMutation,
          variables: { key, value },
        } as any);
        fetchSettings();
      } catch (e) {
        console.error('Failed to update server setting:', e);
      }
    },
    [graphqlService, fetchSettings]
  );

  const registrationOpen = getSettingValue('registration_open') !== 'false';
  // 既定 OFF: 明示的に 'true' のときのみ有効（外部送信ゼロを既定で維持）。
  const linkPreviewEnabled = getSettingValue('link_preview_enabled') === 'true';

  return (
    <>
      <SettingHeader
        title={t['com.affine.admin.nav.settings']()}
        subtitle={t['com.affine.admin.server.subtitle']()}
      />
      <SettingWrapper title={t['com.affine.admin.server.general']()}>
        <div className={styles.userTable}>
          <div className={styles.settingItem}>
            <div className={styles.settingLabel}>
              <div className={styles.settingName}>
                {t['com.affine.admin.server.registration.name']()}
              </div>
              <div className={styles.settingDesc}>
                {t['com.affine.admin.server.registration.desc']()}
              </div>
            </div>
            <Switch
              checked={registrationOpen}
              onChange={(checked: boolean) =>
                updateSetting(
                  'registration_open',
                  checked ? 'true' : 'false'
                )
              }
            />
          </div>
          <SiteNameSetting
            currentValue={getSettingValue('site_name') || ''}
            onSave={value => updateSetting('site_name', value)}
          />
        </div>
      </SettingWrapper>
      <SettingWrapper title={t['com.affine.admin.server.integration']()}>
        <div className={styles.userTable}>
          <div className={styles.settingItem}>
            <div className={styles.settingLabel}>
              <div className={styles.settingName}>
                {t['com.affine.admin.server.linkPreview.name']()}
              </div>
              <div className={styles.settingDesc}>
                {t['com.affine.admin.server.linkPreview.desc']()}
              </div>
            </div>
            <Switch
              checked={linkPreviewEnabled}
              onChange={(checked: boolean) =>
                updateSetting(
                  'link_preview_enabled',
                  checked ? 'true' : 'false'
                )
              }
            />
          </div>
        </div>
      </SettingWrapper>
      {/* #89: シングルサインオン（OIDC）。設定は .env ではなくここに持つ */}
      <SsoSettings />
    </>
  );
};

const SiteNameSetting = ({
  currentValue,
  onSave,
}: {
  currentValue: string;
  onSave: (value: string) => Promise<void>;
}) => {
  const t = useI18n();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentValue);
  const [saving, setSaving] = useState(false);

  const displayValue = editing ? value : currentValue;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [onSave, value]);

  return (
    <div className={styles.settingItem}>
      <div className={styles.settingLabel}>
        <div className={styles.settingName}>
          {t['com.affine.admin.server.siteName.name']()}
        </div>
        <div className={styles.settingDesc}>
          {t['com.affine.admin.server.siteName.desc']()}
        </div>
      </div>
      {editing ? (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            className={styles.formInput}
            value={displayValue}
            onChange={e => setValue(e.target.value)}
            placeholder="ofuro-wiki"
          />
          <Button
            type="primary"
            onClick={handleSave}
            disabled={saving}
          >
            {t['Save']()}
          </Button>
          <Button onClick={() => setEditing(false)}>
            {t['Cancel']()}
          </Button>
        </div>
      ) : (
        <Button onClick={() => { setValue(currentValue); setEditing(true); }}>
          {(currentValue || t['com.affine.admin.server.siteName.notSet']()) +
            ' — ' +
            t['Edit']()}
        </Button>
      )}
    </div>
  );
};
