import { Button, ErrorMessage, Skeleton, Tooltip } from '@ofuro/component';
import { useI18n } from '@ofuro/i18n';
import { useLiveData, useService } from '@toeverything/infra';
import { cssVar } from '@toeverything/theme';
import { useEffect, useMemo } from 'react';

import {
  ServerService,
  SubscriptionService,
  UserQuotaService,
} from '../../../../modules/cloud';
import * as styles from './storage-progress.css';

export interface StorageProgressProgress {
  upgradable?: boolean;
  onUpgrade: () => void;
}

enum ButtonType {
  Primary = 'primary',
  Default = 'secondary',
}

// ofuro-wiki: No per-user storage quota display
export const StorageProgress = (_props: StorageProgressProgress) => {
  return null;
};
