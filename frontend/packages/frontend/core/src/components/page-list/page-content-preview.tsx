import { WorkspaceService } from '@ofuro/core/modules/workspace';
import { useLiveData, useService } from '@toeverything/infra';
import { useAtomValue } from 'jotai';
import { type ReactNode, useMemo } from 'react';

import { useBlockSuitePagePreview } from './use-block-suite-page-preview';

interface PagePreviewProps {
  pageId: string;
  emptyFallback?: ReactNode;
  fallback?: ReactNode;
}

const PagePreviewInner = ({
  pageId,
  emptyFallback,
  fallback,
}: PagePreviewProps) => {
  const workspace = useService(WorkspaceService).workspace;
  const docCollection = workspace.docCollection;
  const page = useMemo(() => {
    return docCollection.getDoc(pageId)?.getStore() ?? null;
  }, [docCollection, pageId]);
  const previewAtom = useBlockSuitePagePreview(page);
  const summary = useAtomValue(previewAtom);

  const res =
    summary === null || summary === undefined
      ? fallback
      : summary === ''
        ? emptyFallback
        : summary;
  return res;
};

export const PagePreview = (props: PagePreviewProps) => {
  return <PagePreviewInner {...props} />;
};
