import { type ReactNode } from 'react';

import * as styles from './index.css';

export const AffineOtherPageLayout = ({
  children,
}: {
  children: ReactNode;
}) => {
  return (
    <div className={styles.root}>
      {BUILD_CONFIG.isElectron ? (
        <div className={styles.draggableHeader} />
      ) : (
        <div className={styles.topNav}>
          <a href="/" rel="noreferrer" className={styles.affineLogo}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>ofuro-wiki</span>
          </a>
        </div>
      )}

      {children}
    </div>
  );
};
