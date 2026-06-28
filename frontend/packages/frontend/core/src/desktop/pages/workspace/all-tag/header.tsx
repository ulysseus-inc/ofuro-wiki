import { ExplorerNavigation } from '@ofuro/core/components/explorer/header/navigation';
import { Header } from '@ofuro/core/components/pure/header';

export const AllTagHeader = () => {
  return <Header left={<ExplorerNavigation active={'tags'} />} />;
};
