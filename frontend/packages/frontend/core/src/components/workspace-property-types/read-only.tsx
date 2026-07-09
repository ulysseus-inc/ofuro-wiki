import { Checkbox, PropertyValue } from '@ofuro/component';
import { type DocRecord, DocService } from '@ofuro/core/modules/doc';
import { useI18n } from '@ofuro/i18n';
import { LockIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { type ChangeEvent, useCallback } from 'react';

import { StackProperty } from '../explorer/docs-view/stack-property';
import { useGuard } from '../guard';
import type { PropertyValueProps } from '../properties/types';
import * as styles from './read-only.css';

/**
 * #66 保護モード（ドキュメント単位の advisory lock）のプロパティ値 UI。
 *
 * 注意: 保護 ON にするとドキュメント全体が読み取り専用になるため、渡ってくる
 * `readonly` prop をトグル可否に使うと「掛けた本人が二度と外せない」状態になる。
 * そのためトグル可否は `readonly` ではなく `Doc_Update` 権限で直接判定する。
 * （Reader はトグル不可でグレーアウト、Member/Owner/Admin は ON/OFF 自由）
 */
export const ReadOnlyValue = (_props: PropertyValueProps) => {
  const docService = useService(DocService);
  const canEdit = useGuard('Doc_Update', docService.doc.id);
  const toggleDisabled = !canEdit;

  const isReadOnly = useLiveData(
    docService.doc.record.properties$.selector(p => p.readOnly)
  );

  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (toggleDisabled) return;
      docService.doc.record.setProperty('readOnly', e.target.checked);
    },
    [docService.doc.record, toggleDisabled]
  );

  const toggle = useCallback(() => {
    if (toggleDisabled) return;
    docService.doc.record.setProperty('readOnly', !isReadOnly);
  }, [docService.doc.record, isReadOnly, toggleDisabled]);

  return (
    <PropertyValue
      className={styles.property}
      onClick={toggle}
      readonly={toggleDisabled}
    >
      <Checkbox
        data-testid="toggle-read-only-checkbox"
        checked={!!isReadOnly}
        onChange={onChange}
        // チェックボックス直接クリック時、click が親の onClick={toggle} まで
        // バブリングして二重に setProperty されるのを防ぐ（onChange のみで完結）。
        onClick={e => e.stopPropagation()}
        className={styles.checkbox}
        disabled={toggleDisabled}
      />
    </PropertyValue>
  );
};

export const ReadOnlyDocListProperty = ({ doc }: { doc: DocRecord }) => {
  const t = useI18n();
  const isReadOnly = useLiveData(doc.properties$.selector(p => p.readOnly));

  if (!isReadOnly) {
    return null;
  }

  return (
    <StackProperty icon={<LockIcon />}>
      {t['com.affine.page-properties.property.readOnly']()}
    </StackProperty>
  );
};
