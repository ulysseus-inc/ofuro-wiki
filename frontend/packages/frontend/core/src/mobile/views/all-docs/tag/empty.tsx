import type { Tag } from '@ofuro/core/modules/tag';

import { TagDetailHeader } from './detail-header';

export const TagEmpty = ({ tag }: { tag: Tag }) => {
  return (
    <>
      <TagDetailHeader tag={tag} />
      Empty
    </>
  );
};
