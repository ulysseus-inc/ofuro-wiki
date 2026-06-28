import { ErrorMessage, Skeleton } from '@ofuro/component';
import { UserQuotaService } from '@ofuro/core/modules/cloud';
import { WorkspaceDialogService } from '@ofuro/core/modules/dialogs';
import { useI18n } from '@ofuro/i18n';
import { useLiveData, useService } from '@toeverything/infra';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import clsx from 'clsx';
import { useEffect } from 'react';

import { UserPlanButton } from '../../affine/auth/user-plan-button';
import { useCatchEventCallback } from '../../hooks/use-catch-event-hook';
import * as styles from './index.css';

// ofuro-wiki: No per-user storage quota display
export const CloudUsage = () => {
  return null;
};
