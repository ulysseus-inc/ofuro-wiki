import { SettingRow } from '@ofuro/component/setting-components';
import { Button } from '@ofuro/component/ui/button';
import { useEnableCloud } from '@ofuro/core/components/hooks/affine/use-enable-cloud';
import {
  type Workspace,
  WorkspaceService,
} from '@ofuro/core/modules/workspace';
import { UNTITLED_WORKSPACE_NAME } from '@ofuro/env/constant';
import { useI18n } from '@ofuro/i18n';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback } from 'react';

export interface PublishPanelProps {
  workspace: Workspace | null;
}

export const EnableCloudPanel = ({
  onCloseSetting,
}: {
  onCloseSetting?: () => void;
}) => {
  const t = useI18n();
  const confirmEnableCloud = useEnableCloud();

  const workspace = useService(WorkspaceService).workspace;
  const name = useLiveData(workspace.name$);
  const flavour = workspace.flavour;

  const confirmEnableCloudAndClose = useCallback(() => {
    if (!workspace) return;
    confirmEnableCloud(workspace, {
      onSuccess: () => {
        onCloseSetting?.();
      },
    });
  }, [confirmEnableCloud, onCloseSetting, workspace]);

  if (flavour !== 'local') {
    return null;
  }

  return (
    <SettingRow
      name={t['Workspace saved locally']({
        name: name ?? UNTITLED_WORKSPACE_NAME,
      })}
      desc={t['Enable cloud hint']()}
      spreadCol={false}
      style={{
        padding: '10px',
        background: 'var(--affine-background-secondary-color)',
        marginTop: '24px',
      }}
    >
      <Button
        data-testid="publish-enable-affine-cloud-button"
        variant="primary"
        onClick={confirmEnableCloudAndClose}
        style={{ marginTop: '12px' }}
      >
        {t['Enable AFFiNE Cloud']()}
      </Button>
    </SettingRow>
  );
};
