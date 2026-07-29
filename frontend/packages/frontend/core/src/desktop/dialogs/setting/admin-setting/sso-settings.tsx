import { Button, Input, notify, Switch } from '@ofuro/component';
import { SettingWrapper } from '@ofuro/component/setting-components';
import { GraphQLService } from '@ofuro/core/modules/cloud';
import {
  oidcConfigQuery,
  testOidcConnectionMutation,
  updateOidcConfigMutation,
} from '@ofuro/graphql';
import { useI18n } from '@ofuro/i18n';
import { useService } from '@toeverything/infra';
import { useCallback, useEffect, useState } from 'react';

import * as styles from './style.css';

/**
 * #89: シングルサインオン（OIDC）の設定。
 *
 * 設定作業で最もつまずくのは**リダイレクト URI**（IdP 側に登録する値）なので、
 * 画面に表示してコピーできるようにしている。
 * また、保存前に IdP との疎通を確認できる「接続をテスト」を用意している。
 */
interface OidcConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecretSet: boolean;
  buttonLabel: string;
  emailClaims: string;
  autoCreateUser: boolean;
  redirectUri: string;
}

/** 更新できる項目（`clientSecretSet` / `redirectUri` は読み取り専用） */
type OidcInput = Omit<OidcConfig, 'clientSecretSet' | 'redirectUri'> & {
  clientSecret: string;
};

const EMPTY: OidcConfig = {
  enabled: false,
  issuer: '',
  clientId: '',
  clientSecretSet: false,
  buttonLabel: '',
  emailClaims: '',
  autoCreateUser: false,
  redirectUri: '',
};

export const SsoSettings = () => {
  const t = useI18n();
  const graphqlService = useService(GraphQLService);

  const [config, setConfig] = useState<OidcConfig>(EMPTY);
  /** 入力中のシークレット。空のまま保存すると既存値が維持される */
  const [secretInput, setSecretInput] = useState('');
  const [saving, setSaving] = useState(false);
  /** 現在値の取得に成功したか。失敗したまま操作させると空値で上書きしてしまう */
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const result = await graphqlService.gql({
        query: oidcConfigQuery,
        variables: {},
      } as any);
      setConfig((result as any).oidcConfig);
      setLoaded(true);
    } catch (e) {
      console.error('Failed to fetch OIDC config:', e);
      notify.error({ title: t['com.affine.admin.sso.load-failed']() });
    }
  }, [graphqlService, t]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const save = useCallback(
    async (patch: Partial<OidcInput>) => {
      // 現在値を取得できていない状態で保存すると、画面上の空欄
      // （＝EMPTY の初期値）をそのまま書き込んでしまう
      if (!loaded) return;

      setSaving(true);
      try {
        const result = await graphqlService.gql({
          query: updateOidcConfigMutation,
          // ⚠️ **変更した項目だけ**を送る。
          // 全項目を毎回送ると、1つの操作（例: スイッチの切り替え）が
          // 他の項目まで画面上の値で上書きしてしまう。
          // 空文字のシークレットも送らない（既存値を消さないため）。
          variables: { input: patch },
        } as any);
        setConfig((result as any).updateOidcConfig);
        setSecretInput('');
        notify.success({ title: t['com.affine.admin.sso.saved']() });
      } catch (e) {
        console.error('Failed to update OIDC config:', e);
        notify.error({ title: t['com.affine.admin.sso.save-failed']() });
      } finally {
        setSaving(false);
      }
    },
    [graphqlService, loaded, t]
  );

  const testConnection = useCallback(async () => {
    setTesting(true);
    try {
      const result = await graphqlService.gql({
        query: testOidcConnectionMutation,
        variables: { issuer: config.issuer },
      } as any);
      const test = (result as any).testOidcConnection;
      if (test.ok) {
        notify.success({ title: test.message, message: test.issuer });
      } else {
        notify.error({ title: test.message });
      }
    } catch (e) {
      console.error('Failed to test OIDC connection:', e);
      notify.error({ title: t['com.affine.admin.sso.test-failed']() });
    } finally {
      setTesting(false);
    }
  }, [config.issuer, graphqlService, t]);

  const copyRedirectUri = useCallback(() => {
    navigator.clipboard
      .writeText(config.redirectUri)
      .then(() => notify.success({ title: t['com.affine.admin.sso.copied']() }))
      .catch(() => {
        notify.error({ title: t['com.affine.admin.sso.copy-failed']() });
      });
  }, [config.redirectUri, t]);

  return (
    <SettingWrapper title={t['com.affine.admin.sso.title']()}>
      <div className={styles.settingItem}>
        <div>
          <div className={styles.settingName}>
            {t['com.affine.admin.sso.enabled']()}
          </div>
          <div className={styles.settingDesc}>
            {t['com.affine.admin.sso.enabled.description']()}
          </div>
        </div>
        <Switch
          checked={config.enabled}
          onChange={checked => save({ enabled: checked })}
          disabled={saving || !loaded}
        />
      </div>

      {/* IdP 側に登録する値。設定作業で最もつまずくため、常に表示してコピーできるようにする */}
      <div className={styles.settingItem}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={styles.settingName}>
            {t['com.affine.admin.sso.redirect-uri']()}
          </div>
          <div className={styles.settingDesc}>
            {t['com.affine.admin.sso.redirect-uri.description']()}
          </div>
          <code className={styles.ssoRedirectUri}>{config.redirectUri}</code>
        </div>
        <Button onClick={copyRedirectUri}>
          {t['com.affine.admin.sso.copy']()}
        </Button>
      </div>

      <div className={styles.settingItem}>
        <div style={{ flex: 1 }}>
          <div className={styles.settingName}>
            {t['com.affine.admin.sso.issuer']()}
          </div>
          <div className={styles.settingDesc}>
            {t['com.affine.admin.sso.issuer.description']()}
          </div>
          <Input
            value={config.issuer}
            placeholder="https://accounts.google.com"
            onChange={value => setConfig(prev => ({ ...prev, issuer: value }))}
            onBlur={() => save({ issuer: config.issuer })}
            disabled={saving || !loaded}
          />
        </div>
      </div>

      <div className={styles.settingItem}>
        <div style={{ flex: 1 }}>
          <div className={styles.settingName}>
            {t['com.affine.admin.sso.client-id']()}
          </div>
          <Input
            value={config.clientId}
            onChange={value => setConfig(prev => ({ ...prev, clientId: value }))}
            onBlur={() => save({ clientId: config.clientId })}
            disabled={saving || !loaded}
          />
        </div>
      </div>

      <div className={styles.settingItem}>
        <div style={{ flex: 1 }}>
          <div className={styles.settingName}>
            {t['com.affine.admin.sso.client-secret']()}
          </div>
          <div className={styles.settingDesc}>
            {config.clientSecretSet
              ? t['com.affine.admin.sso.client-secret.set']()
              : t['com.affine.admin.sso.client-secret.unset']()}
          </div>
          <Input
            value={secretInput}
            type="password"
            placeholder={
              config.clientSecretSet ? '********' : t['com.affine.admin.sso.client-secret.placeholder']()
            }
            onChange={setSecretInput}
            onBlur={() => secretInput && save({ clientSecret: secretInput })}
            disabled={saving || !loaded}
          />
        </div>
      </div>

      <div className={styles.settingItem}>
        <div style={{ flex: 1 }}>
          <div className={styles.settingName}>
            {t['com.affine.admin.sso.button-label']()}
          </div>
          <Input
            value={config.buttonLabel}
            placeholder="Google でサインイン"
            onChange={value =>
              setConfig(prev => ({ ...prev, buttonLabel: value }))
            }
            onBlur={() => save({ buttonLabel: config.buttonLabel })}
            disabled={saving || !loaded}
          />
        </div>
      </div>

      <div className={styles.settingItem}>
        <div style={{ flex: 1 }}>
          <div className={styles.settingName}>
            {t['com.affine.admin.sso.email-claims']()}
          </div>
          <div className={styles.settingDesc}>
            {t['com.affine.admin.sso.email-claims.description']()}
          </div>
          <Input
            value={config.emailClaims}
            placeholder="email,preferred_username,upn"
            onChange={value =>
              setConfig(prev => ({ ...prev, emailClaims: value }))
            }
            onBlur={() => save({ emailClaims: config.emailClaims })}
            disabled={saving || !loaded}
          />
        </div>
      </div>

      {/* 既定 OFF。IdP の性質によって正解が逆になるため、警告文を添えて選ばせる */}
      <div className={styles.settingItem}>
        <div>
          <div className={styles.settingName}>
            {t['com.affine.admin.sso.auto-create']()}
          </div>
          <div className={styles.settingDesc}>
            {t['com.affine.admin.sso.auto-create.description']()}
          </div>
        </div>
        <Switch
          checked={config.autoCreateUser}
          onChange={checked => save({ autoCreateUser: checked })}
          disabled={saving || !loaded}
        />
      </div>

      <div className={styles.settingItem}>
        <Button onClick={testConnection} disabled={testing || !config.issuer}>
          {testing
            ? t['com.affine.admin.sso.testing']()
            : t['com.affine.admin.sso.test']()}
        </Button>
      </div>
    </SettingWrapper>
  );
};
