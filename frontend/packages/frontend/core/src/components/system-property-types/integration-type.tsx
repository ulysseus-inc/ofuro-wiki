// Integration module removed in ofuro-wiki
import type { FilterParams } from '@ofuro/core/modules/collection-rules';
import type { DocRecord } from '@ofuro/core/modules/doc';

import type { GroupHeaderProps } from '../explorer/types';

export const IntegrationTypeFilterValue = (_props: {
  filter: FilterParams;
  isDraft?: boolean;
  onDraftCompleted?: () => void;
  onChange?: (filter: FilterParams) => void;
}) => {
  return null;
};

export const IntegrationTypeDocListProperty = (_props: { doc: DocRecord }) => {
  return null;
};

export const IntegrationTypeGroupHeader = (_props: GroupHeaderProps) => {
  return null;
};
