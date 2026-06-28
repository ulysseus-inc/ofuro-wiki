import type { Collection } from '@ofuro/core/modules/collection';

import { DetailHeader } from './detail';

export const EmptyCollection = ({ collection }: { collection: Collection }) => {
  return (
    <>
      <DetailHeader collection={collection} />
      Empty
    </>
  );
};
