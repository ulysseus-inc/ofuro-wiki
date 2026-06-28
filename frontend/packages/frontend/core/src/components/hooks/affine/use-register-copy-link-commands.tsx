import {
  PreconditionStrategy,
  registerAffineCommand,
} from '@ofuro/core/commands';
import { useSharingUrl } from '@ofuro/core/components/hooks/affine/use-share-url';
import { useIsActiveView } from '@ofuro/core/modules/workbench';
import type { WorkspaceMetadata } from '@ofuro/core/modules/workspace';
import { track } from '@ofuro/track';
import { useEffect } from 'react';

export function useRegisterCopyLinkCommands({
  workspaceMeta,
  docId,
}: {
  workspaceMeta: WorkspaceMetadata;
  docId: string;
}) {
  const isActiveView = useIsActiveView();
  const workspaceId = workspaceMeta.id;
  const isCloud = workspaceMeta.flavour !== 'local';

  const { onClickCopyLink } = useSharingUrl({
    workspaceId,
    pageId: docId,
  });

  useEffect(() => {
    if (!isActiveView) {
      return;
    }
    const unsubs: Array<() => void> = [];

    unsubs.push(
      registerAffineCommand({
        id: `affine:share-private-link:${docId}`,
        category: 'affine:general',
        preconditionStrategy: PreconditionStrategy.Never,
        keyBinding: {
          binding: '$mod+Shift+c',
        },
        label: '',
        icon: null,
        run() {
          track.$.cmdk.general.copyShareLink();
          isActiveView && isCloud && onClickCopyLink();
        },
      })
    );
    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [docId, isActiveView, isCloud, onClickCopyLink]);
}
