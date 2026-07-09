import { DocService } from '@ofuro/core/modules/doc';
import { useI18n } from '@ofuro/i18n';
import { LockIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';

import * as styles from './doc-protection-banner.css';

/**
 * #66 保護モードのバナー。
 *
 * 保護 ON のドキュメントを開くと上部に常時表示し、保護状態に気づけるようにする。
 * 誤操作防止が目的のため、バナーからのワンクリック解除は用意しない。解除は
 * 情報（ⓘ）→ワークスペースのプロパティ→「保護モード」トグルから行う（本来の方法）。
 */
export const DocProtectionBanner = () => {
  const t = useI18n();
  const docService = useService(DocService);

  const isProtected = useLiveData(
    docService.doc.record.properties$.selector(p => p.readOnly)
  );

  if (!isProtected) {
    return null;
  }

  return (
    <div className={styles.banner} data-testid="doc-protection-banner">
      <span className={styles.icon}>
        <LockIcon />
      </span>
      <span className={styles.message}>
        {t['com.affine.doc-protection.banner.title']()}
      </span>
    </div>
  );
};
