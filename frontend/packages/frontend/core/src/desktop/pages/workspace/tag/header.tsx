import { ExplorerDisplayMenuButton } from '@ofuro/core/components/explorer/display-menu';
import { ExplorerNavigation } from '@ofuro/core/components/explorer/header/navigation';
import type { ExplorerDisplayPreference } from '@ofuro/core/components/explorer/types';
import { Header } from '@ofuro/core/components/pure/header';

export const TagDetailHeader = ({
  displayPreference,
  onDisplayPreferenceChange,
}: {
  displayPreference: ExplorerDisplayPreference;
  onDisplayPreferenceChange: (
    displayPreference: ExplorerDisplayPreference
  ) => void;
}) => {
  return (
    <Header
      left={<ExplorerNavigation active={'tags'} />}
      right={
        <ExplorerDisplayMenuButton
          displayPreference={displayPreference}
          onDisplayPreferenceChange={onDisplayPreferenceChange}
        />
      }
    />
  );
};
