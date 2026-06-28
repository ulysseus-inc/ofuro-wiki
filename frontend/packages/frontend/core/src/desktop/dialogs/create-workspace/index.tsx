import { Button, ConfirmModal, notify, RowInput } from '@ofuro/component';
import { useAsyncCallback } from '@ofuro/core/components/hooks/affine-async-hooks';
import {
  AuthService,
  type Server,
  ServersService,
} from '@ofuro/core/modules/cloud';
import {
  type DialogComponentProps,
  type GLOBAL_DIALOG_SCHEMA,
  GlobalDialogService,
} from '@ofuro/core/modules/dialogs';
import { WorkspacesService } from '@ofuro/core/modules/workspace';
import { buildShowcaseWorkspace } from '@ofuro/core/utils/first-app-data';
import { useI18n } from '@ofuro/i18n';
import track from '@ofuro/track';
import { FrameworkScope, useLiveData, useService } from '@toeverything/infra';
import { useCallback, useState } from 'react';

import * as styles from './index.css';
import { ServerSelector } from './server-selector';

const FormSection = ({
  label,
  input,
}: {
  label: string;
  input: React.ReactNode;
}) => {
  return (
    <section className={styles.section}>
      <label className={styles.label}>{label}</label>
      {input}
    </section>
  );
};

export const CreateWorkspaceDialog = ({
  serverId,
  close,
  ...props
}: DialogComponentProps<GLOBAL_DIALOG_SCHEMA['create-workspace']>) => {
  const t = useI18n();

  const [workspaceName, setWorkspaceName] = useState('');
  const [inputServerId, setInputServerId] = useState(
    serverId ?? 'ofuro-cloud'
  );

  const serversService = useService(ServersService);
  const server = useLiveData(
    inputServerId ? serversService.server$(inputServerId) : null
  );

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) close();
    },
    [close]
  );

  return (
    <ConfirmModal
      open
      onOpenChange={onOpenChange}
      title={t['com.affine.nameWorkspace.title']()}
      description={t['com.affine.nameWorkspace.description']()}
      cancelText={t['com.affine.nameWorkspace.button.cancel']()}
      closeButtonOptions={{
        ['data-testid' as string]: 'create-workspace-close-button',
      }}
      contentOptions={{}}
      childrenContentClassName={styles.content}
      customConfirmButton={() => {
        return (
          <FrameworkScope scope={server?.scope}>
            <CustomConfirmButton
              workspaceName={workspaceName}
              server={server}
              onCreated={res =>
                close({ metadata: res.meta, defaultDocId: res.defaultDocId })
              }
            />
          </FrameworkScope>
        );
      }}
      {...props}
    >
      <FormSection
        label={t['com.affine.nameWorkspace.subtitle.workspace-name']()}
        input={
          <RowInput
            autoFocus
            className={styles.input}
            data-testid="create-workspace-input"
            placeholder={t['com.affine.nameWorkspace.placeholder']()}
            maxLength={64}
            minLength={0}
            onChange={setWorkspaceName}
          />
        }
      />

      <FormSection
        label={t['com.affine.nameWorkspace.subtitle.workspace-type']()}
        input={
          <ServerSelector
            className={styles.select}
            selectedId={inputServerId}
            onChange={setInputServerId}
          />
        }
      />
    </ConfirmModal>
  );
};

const CustomConfirmButton = ({
  workspaceName,
  server,
  onCreated,
}: {
  workspaceName: string;
  server?: Server | null;
  onCreated: (res: Awaited<ReturnType<typeof buildShowcaseWorkspace>>) => void;
}) => {
  const t = useI18n();
  const [loading, setLoading] = useState(false);

  const session = useService(AuthService).session;
  const loginStatus = useLiveData(session.status$);
  const globalDialogService = useService(GlobalDialogService);
  const workspacesService = useService(WorkspacesService);

  const openSignInModal = useCallback(() => {
    globalDialogService.open('sign-in', { server: server?.baseUrl });
  }, [globalDialogService, server?.baseUrl]);

  const handleConfirm = useAsyncCallback(async () => {
    if (loading) return;
    setLoading(true);
    track.$.$.$.createWorkspace({
      flavour: !server ? 'local' : 'ofuro-cloud',
    });

    // this will be the last step for web for now
    // fix me later
    try {
      const res = await buildShowcaseWorkspace(
        workspacesService,
        server?.id ?? 'local',
        workspaceName
      );
      onCreated(res);
    } catch (e) {
      console.error(e);
      notify.error({
        title: 'Failed to create workspace',
        message: 'please try again later.',
      });
    } finally {
      setLoading(false);
    }
  }, [loading, onCreated, server, workspaceName, workspacesService]);

  const handleCheckSessionAndConfirm = useCallback(() => {
    if (server && loginStatus !== 'authenticated') {
      return openSignInModal();
    }
    handleConfirm();
  }, [handleConfirm, loginStatus, openSignInModal, server]);

  return (
    <Button
      disabled={!workspaceName}
      data-testid="create-workspace-create-button"
      variant="primary"
      onClick={handleCheckSessionAndConfirm}
      loading={loading}
    >
      {t['com.affine.nameWorkspace.button.create']()}
    </Button>
  );
};
