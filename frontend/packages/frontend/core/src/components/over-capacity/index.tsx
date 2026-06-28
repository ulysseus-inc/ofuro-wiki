import { notify } from '@ofuro/component';
import { WorkspaceDialogService } from '@ofuro/core/modules/dialogs';
import { WorkspacePermissionService } from '@ofuro/core/modules/permissions';
import { WorkspaceService } from '@ofuro/core/modules/workspace';
import { useI18n } from '@ofuro/i18n';
import type { BlobSyncState } from '@ofuro/nbstore';
import { useLiveData, useService } from '@toeverything/infra';
import { debounce } from 'lodash-es';
import { useCallback, useEffect } from 'react';

/**
 * TODO(eyhn): refactor this
 */
// ofuro-wiki: No per-user capacity limits
export const OverCapacityNotification = () => {
  return null;
};
