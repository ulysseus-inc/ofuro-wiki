import { useRegisterFindInPageCommands } from '@ofuro/core/components/hooks/affine/use-register-find-in-page-commands';
import { useRegisterWorkspaceCommands } from '@ofuro/core/components/hooks/use-register-workspace-commands';
import { OverCapacityNotification } from '@ofuro/core/components/over-capacity';
import { useRegisterNavigationCommands } from '@ofuro/core/modules/navigation/view/use-register-navigation-commands';
import { QuickSearchContainer } from '@ofuro/core/modules/quicksearch';

/**
 * @deprecated just for legacy code, will be removed in the future
 */
export const WorkspaceSideEffects = () => {
  // AI provider setup removed in ofuro-wiki

  useRegisterWorkspaceCommands();
  useRegisterNavigationCommands();
  useRegisterFindInPageCommands();

  return (
    <>
      <QuickSearchContainer />
      <OverCapacityNotification />
    </>
  );
};
