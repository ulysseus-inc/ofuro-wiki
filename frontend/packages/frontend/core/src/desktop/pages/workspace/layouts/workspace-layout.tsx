import { uniReactRoot } from '@ofuro/component';
import { useResponsiveSidebar } from '@ofuro/core/components/hooks/use-responsive-siedebar';
import { SWRConfigProvider } from '@ofuro/core/components/providers/swr-config-provider';
import { WorkspaceSideEffects } from '@ofuro/core/components/providers/workspace-side-effects';
import { AppContainer } from '@ofuro/core/desktop/components/app-container';
import { DocumentTitle } from '@ofuro/core/desktop/components/document-title';
import { WorkspaceDialogs } from '@ofuro/core/desktop/dialogs';
import { PeekViewManagerModal } from '@ofuro/core/modules/peek-view';
import { WorkbenchService } from '@ofuro/core/modules/workbench';
import { LiveData, useLiveData, useService } from '@toeverything/infra';
import type { PropsWithChildren } from 'react';

export const WorkspaceLayout = function WorkspaceLayout({
  children,
}: PropsWithChildren) {
  return (
    <SWRConfigProvider>
      <WorkspaceDialogs />

      {/* ---- some side-effect components ---- */}
      <WorkspaceSideEffects />
      <PeekViewManagerModal />
      <DocumentTitle />

      <WorkspaceLayoutInner>{children}</WorkspaceLayoutInner>
      <uniReactRoot.Root />
    </SWRConfigProvider>
  );
};

/**
 * Wraps the workspace layout main router view
 */
const WorkspaceLayoutUIContainer = ({ children }: PropsWithChildren) => {
  const workbench = useService(WorkbenchService).workbench;
  const currentPath = useLiveData(
    LiveData.computed(get => {
      return get(workbench.basename$) + get(workbench.location$).pathname;
    })
  );
  useResponsiveSidebar();

  return (
    <AppContainer data-current-path={currentPath}>{children}</AppContainer>
  );
};
const WorkspaceLayoutInner = ({ children }: PropsWithChildren) => {
  return <WorkspaceLayoutUIContainer>{children}</WorkspaceLayoutUIContainer>;
};
