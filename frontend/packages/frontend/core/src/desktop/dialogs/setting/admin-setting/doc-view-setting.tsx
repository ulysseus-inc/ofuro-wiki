import { Switch, useConfirmModal } from '@ofuro/component';
import { useI18n } from '@ofuro/i18n';
import { useCallback } from 'react';

import * as styles from './style.css';

/** #100: 記録するかの設定キー（backend の DOC_VIEW_SETTING_KEY と同じ） */
export const DOC_VIEW_SETTING_KEY = 'audit_log_doc_view_enabled';

/**
 * #100: ページの閲覧を監査ログに残すか（docs/logging.md 2.11）。
 *
 * 既定は記録しない。個人の行動の記録になり、量も増えるため、
 * 「記録する」にするときだけ確認の窓を出す。戻すときは確かめない。
 */
export const DocViewSetting = ({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) => {
  const t = useI18n();
  const { openConfirmModal } = useConfirmModal();

  const onToggle = useCallback(
    (checked: boolean) => {
      if (!checked) {
        onChange(false);
        return;
      }

      openConfirmModal({
        title: t['com.ofuro.admin.server.docView.confirm.title'](),
        children: (
          <ul data-testid="doc-view-confirm" className={styles.confirmList}>
            <li>{t['com.ofuro.admin.server.docView.confirm.who']()}</li>
            <li>{t['com.ofuro.admin.server.docView.confirm.notice']()}</li>
            <li>{t['com.ofuro.admin.server.docView.confirm.volume']()}</li>
          </ul>
        ),
        confirmText: t['com.ofuro.admin.server.docView.confirm.button'](),
        cancelText: t['Cancel'](),
        onConfirm: () => onChange(true),
        confirmButtonOptions: { variant: 'primary' },
      });
    },
    [openConfirmModal, onChange, t]
  );

  return (
    <div className={styles.settingItem}>
      <div className={styles.settingLabel}>
        <div className={styles.settingName}>
          {t['com.ofuro.admin.server.docView.name']()}
        </div>
        <div className={styles.settingDesc}>
          <div>{t['com.ofuro.admin.server.docView.desc']()}</div>
          {/* プライベートは記録しない。見落とされやすいので目立たせる */}
          <div>
            <strong>{t['com.ofuro.admin.server.docView.scope']()}</strong>
          </div>
          <div>{t['com.ofuro.admin.server.docView.once']()}</div>
        </div>
      </div>
      <Switch
        data-testid="doc-view-switch"
        checked={enabled}
        onChange={onToggle}
      />
    </div>
  );
};
