import * as Dialog from '@radix-ui/react-dialog';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import { useEffect } from 'react';
import { useTransition } from 'react-transition-state';

import * as styles from './modal.css';

// a QuickSearch modal that can be used to display a QuickSearch command
// it has a smooth animation and can be closed by clicking outside of the modal

export interface QuickSearchModalProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  /** #321: 閉じきった（Radix の窓も外れた）あとに呼ぶ */
  onExited?: () => void;
}

const animationTimeout = 120;

export const QuickSearchModal = ({
  onOpenChange,
  onExited,
  open,
  children,
}: React.PropsWithChildren<QuickSearchModalProps>) => {
  const [{ status }, toggle] = useTransition({
    timeout: animationTimeout,
  });
  useEffect(() => {
    toggle(open);
  }, [open]);
  useEffect(() => {
    if (status === 'exited') {
      onExited?.();
    }
  }, [status, onExited]);
  return (
    <Dialog.Root modal open={status !== 'exited'} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.modalOverlay} />
        <div className={styles.modalContentWrapper}>
          <Dialog.Content
            style={assignInlineVars({
              [styles.animationTimeout]: `${animationTimeout}ms`,
            })}
            className={styles.modalContent}
            data-state={status}
          >
            {children}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
