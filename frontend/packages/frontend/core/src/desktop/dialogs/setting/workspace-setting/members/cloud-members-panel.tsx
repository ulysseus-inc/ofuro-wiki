import { Button, Loading, notify } from '@ofuro/component';
import {
  InviteTeamMemberModal,
  type InviteTeamMemberModalProps,
  MemberLimitModal,
} from '@ofuro/component/member-components';
import { SettingRow } from '@ofuro/component/setting-components';
import { useAsyncCallback } from '@ofuro/core/components/hooks/affine-async-hooks';
import { Upload } from '@ofuro/core/components/pure/file-upload';
import {
  ServerService,
} from '@ofuro/core/modules/cloud';
import {
  WorkspaceMembersService,
  WorkspacePermissionService,
} from '@ofuro/core/modules/permissions';

import { WorkspaceShareSettingService } from '@ofuro/core/modules/share-setting';
import { copyTextToClipboard } from '@ofuro/core/utils/clipboard';
import { emailRegex } from '@ofuro/core/utils/email-regex';
import { UserFriendlyError } from '@ofuro/error';
import type { WorkspaceInviteLinkExpireTime } from '@ofuro/graphql';
import { useI18n } from '@ofuro/i18n';
import { track } from '@ofuro/track';
import { ExportIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SettingState } from '../../types';
import { MemberList } from './member-list';
import * as styles from './styles.css';

const parseCSV = async (blob: Blob): Promise<string[]> => {
  try {
    const textContent = await blob.text();
    const emails = textContent
      .split('\n')
      .map(email => email.trim())
      .filter(email => email.length > 0 && emailRegex.test(email));

    return emails;
  } catch (error) {
    console.error('Error parsing CSV:', error);
    throw new Error('Failed to parse CSV');
  }
};

export const CloudWorkspaceMembersPanel = ({
  onChangeSettingState,
  isTeam,
}: {
  onChangeSettingState: (settingState: SettingState) => void;
  isTeam?: boolean;
}) => {
  const workspaceShareSettingService = useService(WorkspaceShareSettingService);
  const inviteLink = useLiveData(
    workspaceShareSettingService.sharePreview.inviteLink$
  );
  const serverService = useService(ServerService);
  const hasPaymentFeature = useLiveData(
    serverService.server.features$.map(f => f?.payment)
  );
  const membersService = useService(WorkspaceMembersService);
  const permissionService = useService(WorkspacePermissionService);

  const isOwner = useLiveData(permissionService.permission.isOwner$);
  const isAdmin = useLiveData(permissionService.permission.isAdmin$);
  const isOwnerOrAdmin = isOwner || isAdmin;
  useEffect(() => {
    permissionService.permission.revalidate();
  }, [permissionService]);

  useEffect(() => {
    membersService.members.revalidate();
  }, [membersService]);

  const isLoading = false;
  const error = null;
  // No quota limits in ofuro-wiki
  const workspaceQuota = {
    memberCount: 0,
    memberLimit: Infinity,
    humanReadable: { name: 'Unlimited', memberLimit: 'Unlimited' },
  };
  const t = useI18n();

  const [openInvite, setOpenInvite] = useState(false);
  const [openMemberLimit, setOpenMemberLimit] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  const goToTeamBilling = useCallback(() => {
    // ofuro-wiki: no billing page
  }, []);
  const openInviteModal = useCallback(() => {
    setOpenInvite(true);
  }, []);

  const onGenerateInviteLink = useCallback(
    async (expireTime: WorkspaceInviteLinkExpireTime) => {
      const { link } = await membersService.generateInviteLink(expireTime);
      workspaceShareSettingService.sharePreview.revalidate();
      return link;
    },
    [membersService, workspaceShareSettingService.sharePreview]
  );

  const onRevokeInviteLink = useCallback(async () => {
    const success = await membersService.revokeInviteLink();
    workspaceShareSettingService.sharePreview.revalidate();
    return success;
  }, [membersService, workspaceShareSettingService.sharePreview]);

  const onInviteBatchConfirm = useAsyncCallback(
    async ({
      emails,
    }: Parameters<InviteTeamMemberModalProps['onConfirm']>[0]) => {
      setIsMutating(true);
      const uniqueEmails = deduplicateEmails(emails);
      if (
        !isTeam &&
        workspaceQuota &&
        uniqueEmails.length >
          workspaceQuota.memberLimit - workspaceQuota.memberCount
      ) {
        setOpenMemberLimit(true);
        setIsMutating(false);
        return;
      }
      const results = await membersService.inviteMembers(uniqueEmails);
      const unSuccessInvites = results.reduce<string[]>((acc, result) => {
        if (!result.sentSuccess) {
          acc.push(result.email);
        }
        return acc;
      }, []);
      if (results) {
        notify({
          title: t['com.affine.payment.member.team.invite.notify.title']({
            successCount: (
              uniqueEmails.length - unSuccessInvites.length
            ).toString(),
            failedCount: unSuccessInvites.length.toString(),
          }),
          message: <NotifyMessage unSuccessInvites={unSuccessInvites} />,
        });
        setOpenInvite(false);
        membersService.members.revalidate();
      }
      setIsMutating(false);
    },
    [isTeam, membersService, t, workspaceQuota]
  );

  const onImportCSV = useAsyncCallback(
    async (file: File) => {
      setIsMutating(true);
      const emails = await parseCSV(file);
      onInviteBatchConfirm({ emails });
      setIsMutating(false);
    },
    [onInviteBatchConfirm]
  );

  const handleUpgradeConfirm = useCallback(() => {
    onChangeSettingState({
      activeTab: 'plans',
      scrollAnchor: 'cloudPricingPlan',
    });
    track.$.settingsPanel.workspace.viewPlans({
      control: 'inviteMember',
    });
  }, [onChangeSettingState]);

  const desc = useMemo(() => {
    if (!workspaceQuota) return null;

    if (isTeam) {
      return <span>{t['com.affine.payment.member.team.description']()}</span>;
    }
    return (
      <span>
        {t['com.affine.payment.member.description2']()}
        {hasPaymentFeature && isOwner ? (
          <div
            className={styles.goUpgradeWrapper}
            onClick={handleUpgradeConfirm}
          >
            <span className={styles.goUpgrade}>
              {t['com.affine.payment.member.description.choose-plan']()}
            </span>
          </div>
        ) : null}
      </span>
    );
  }, [
    handleUpgradeConfirm,
    hasPaymentFeature,
    isOwner,
    isTeam,
    t,
    workspaceQuota,
  ]);

  const title = useMemo(() => {
    if (isTeam) {
      return `${t['Members']()} (${workspaceQuota?.memberCount})`;
    }
    return `${t['Members']()} (${workspaceQuota?.memberCount}/${workspaceQuota?.memberLimit})`;
  }, [isTeam, t, workspaceQuota?.memberCount, workspaceQuota?.memberLimit]);

  if (workspaceQuota === null) {
    if (isLoading) {
      return <MembersPanelFallback />;
    } else {
      return (
        <span className={styles.errorStyle}>
          {error
            ? UserFriendlyError.fromAny(error).message
            : 'Failed to load members'}
        </span>
      );
    }
  }

  return (
    <>
      <SettingRow name={title} desc={desc} spreadCol={!!isOwnerOrAdmin}>
        {isOwnerOrAdmin ? (
          <>
            <Button onClick={openInviteModal}>{t['Invite Members']()}</Button>
            {!isTeam ? (
              <MemberLimitModal
                isFreePlan={false}
                open={openMemberLimit}
                plan={workspaceQuota.humanReadable.name ?? ''}
                quota={workspaceQuota.humanReadable.memberLimit ?? ''}
                setOpen={setOpenMemberLimit}
                onConfirm={handleUpgradeConfirm}
              />
            ) : null}
            <InviteTeamMemberModal
              open={openInvite}
              setOpen={setOpenInvite}
              onConfirm={onInviteBatchConfirm}
              isMutating={isMutating}
              copyTextToClipboard={copyTextToClipboard}
              onGenerateInviteLink={onGenerateInviteLink}
              onRevokeInviteLink={onRevokeInviteLink}
              importCSV={<ImportCSV onImport={onImportCSV} />}
              invitationLink={inviteLink}
            />
          </>
        ) : null}
      </SettingRow>

      <div className={styles.membersPanel}>
        <MemberList
          isOwner={!!isOwner}
          isAdmin={!!isAdmin}
          goToTeamBilling={goToTeamBilling}
        />
      </div>
    </>
  );
};

const NotifyMessage = ({
  unSuccessInvites,
}: {
  unSuccessInvites: string[];
}) => {
  const t = useI18n();

  if (unSuccessInvites.length === 0) {
    return t['Invitation sent hint']();
  }

  return (
    <div>
      {t['com.affine.payment.member.team.invite.notify.fail-message']()}
      {unSuccessInvites.map((email, index) => (
        <div key={`${index}:${email}`}>{email}</div>
      ))}
    </div>
  );
};

export const MembersPanelFallback = () => {
  const t = useI18n();

  return (
    <>
      <SettingRow
        name={t['Members']()}
        desc={t['com.affine.payment.member.description2']()}
      />
      <div className={styles.membersPanel}>
        <MemberListFallback memberCount={1} />
      </div>
    </>
  );
};

const MemberListFallback = ({ memberCount }: { memberCount?: number }) => {
  // prevent page jitter
  const height = useMemo(() => {
    if (memberCount) {
      // height and margin-bottom
      return memberCount * 58 + (memberCount - 1) * 6;
    }
    return 'auto';
  }, [memberCount]);
  const t = useI18n();

  return (
    <div
      style={{
        height,
      }}
      className={styles.membersFallback}
    >
      <Loading size={20} />
      <span>{t['com.affine.settings.member.loading']()}</span>
    </div>
  );
};

const ImportCSV = ({ onImport }: { onImport: (file: File) => void }) => {
  const t = useI18n();

  return (
    <Upload accept="text/csv" fileChange={onImport}>
      <Button
        className={styles.importButton}
        prefix={<ExportIcon />}
        variant="secondary"
      >
        {t['com.affine.payment.member.team.invite.import-csv']()}
      </Button>
    </Upload>
  );
};

function deduplicateEmails(emails: string[]): string[] {
  const seenEmails = new Set<string>();
  return emails.filter(email => {
    const lowerCaseEmail = email.trim().toLowerCase();
    if (seenEmails.has(lowerCaseEmail)) {
      return false;
    } else {
      seenEmails.add(lowerCaseEmail);
      return true;
    }
  });
}
