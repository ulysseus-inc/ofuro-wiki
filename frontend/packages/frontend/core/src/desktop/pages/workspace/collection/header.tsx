import { FlexWrapper } from '@ofuro/component';
import { ExplorerDisplayMenuButton } from '@ofuro/core/components/explorer/display-menu';
import { ViewToggle } from '@ofuro/core/components/explorer/display-menu/view-toggle';
import { ExplorerNavigation } from '@ofuro/core/components/explorer/header/navigation';
import type { ExplorerDisplayPreference } from '@ofuro/core/components/explorer/types';
import { Header } from '@ofuro/core/components/pure/header';

export const CollectionDetailHeader = ({
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
      right={
        <FlexWrapper gap={16}>
          <ViewToggle
            view={displayPreference.view ?? 'list'}
            onViewChange={view => {
              onDisplayPreferenceChange({ ...displayPreference, view });
            }}
          />
          <ExplorerDisplayMenuButton
            displayPreference={displayPreference}
            onDisplayPreferenceChange={onDisplayPreferenceChange}
          />
        </FlexWrapper>
      }
      left={<ExplorerNavigation active="collections" />}
    />
  );
};
