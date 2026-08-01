import {
  Avatar,
  Button,
  ConfirmModal,
  IconButton,
  Menu,
  MenuItem,
  Switch,
  notify,
} from '@ofuro/component';
import { MoreVerticalIcon } from '@blocksuite/icons/rc';
import { SettingHeader, SettingWrapper } from '@ofuro/component/setting-components';
import { GraphQLService } from '@ofuro/core/modules/cloud';
import { useI18n } from '@ofuro/i18n';
import {
  adminUserListQuery,
  adminCreateUserMutation,
  adminDeleteUserMutation,
  adminSetUserAdminMutation,
  createChangePasswordUrlMutation,
  adminSetUserPasswordMutation,
} from '@ofuro/graphql';
import { useService } from '@toeverything/infra';
import { useCallback, useEffect, useState } from 'react';

import { CsvImport } from './csv-import';
import * as styles from './style.css';

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  emailVerified: boolean;
  createdAt: string;
}

export const UserManagement = () => {
  const t = useI18n();
  const graphqlService = useService(GraphQLService);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [showCreateForm, setShowCreateForm] = useState(false);
  /** #92: CSV 一括登録のパネルを開いているか */
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  /** #115: 発行したパスワード再設定 URL（閉じると再表示できない） */
  const [resetUrl, setResetUrl] = useState<{ user: AdminUser; url: string } | null>(
    null
  );
  const [issuingFor, setIssuingFor] = useState<string | null>(null);
  /** #115: パスワードを直接再設定する対象（機能 3） */
  const [passwordTarget, setPasswordTarget] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(false);
  const pageSize = 20;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const result = await graphqlService.gql({
        query: adminUserListQuery,
        variables: {
          search: search || undefined,
          skip: page * pageSize,
          take: pageSize,
        },
      } as any);
      setUsers((result as any).adminUserList.items);
      setTotalCount((result as any).adminUserList.totalCount);
    } finally {
      setLoading(false);
    }
  }, [graphqlService, search, page]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleToggleAdmin = useCallback(
    async (userId: string, isAdmin: boolean) => {
      try {
        await graphqlService.gql({
          query: adminSetUserAdminMutation,
          variables: { userId, isAdmin },
        } as any);
        fetchUsers();
      } catch (e) {
        console.error('Failed to toggle admin:', e);
      }
    },
    [graphqlService, fetchUsers]
  );

  const handleDeleteUser = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await graphqlService.gql({
        query: adminDeleteUserMutation,
        variables: { userId: deleteTarget.id },
      } as any);
      setDeleteTarget(null);
      fetchUsers();
    } catch (e) {
      console.error('Failed to delete user:', e);
      notify.error({
        title: t['com.affine.admin.users.delete.failed']({
          message: e instanceof Error ? e.message : String(e),
        }),
      });
    }
  }, [graphqlService, deleteTarget, fetchUsers, t]);

  /**
   * #115: パスワード再設定用の URL を発行する。
   *
   * パスワード変更機能の 4。3（直接再設定）と違い、パスワードは本人が決めるため
   * Admin は本人のパスワードを知らない。**渡せる相手にはこちらを使う。**
   * SMTP 未設定の環境でも使えるよう、メール送信ではなく画面に出してコピーさせる。
   * SMTP 有効時に本人へ自動送信する Level2 は #132（v0.1.0 スコープ外）。
   */
  const handleIssueResetUrl = useCallback(
    async (user: AdminUser) => {
      setIssuingFor(user.id);
      try {
        const result = await graphqlService.gql({
          query: createChangePasswordUrlMutation,
          variables: {
            userId: user.id,
            // 再設定画面のルート（router.tsx の /auth/:authType）
            callbackUrl: `${location.origin}/auth/changePassword`,
          },
        } as any);
        setResetUrl({ user, url: (result as any).createChangePasswordUrl });
      } catch (e) {
        console.error('Failed to create password reset url:', e);
        notify.error({
          title: t['com.affine.admin.users.resetPassword.failed'](),
        });
      } finally {
        setIssuingFor(null);
      }
    },
    [graphqlService, t]
  );

  const handleCopyResetUrl = useCallback(() => {
    if (!resetUrl) return;
    navigator.clipboard
      .writeText(resetUrl.url)
      .then(() =>
        notify.success({
          title: t['com.affine.admin.users.resetPassword.copied'](),
        })
      )
      .catch(() =>
        notify.error({
          title: t['com.affine.admin.users.resetPassword.copyFailed'](),
        })
      );
  }, [resetUrl, t]);

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <>
      <SettingHeader
        title={t['com.affine.admin.nav.users']()}
        subtitle={t['com.affine.admin.users.subtitle']()}
      />
      <div className={styles.searchBar}>
        <input
          data-testid="admin-user-search"
          className={styles.searchInput}
          placeholder={t['com.affine.admin.users.search']()}
          value={search}
          onChange={e => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <Button
          data-testid="admin-csv-import-toggle"
          onClick={() => {
            setShowCsvImport(v => !v);
            setShowCreateForm(false);
          }}
        >
          {showCsvImport
            ? t['Cancel']()
            : t['com.affine.admin.users.csv.open']()}
        </Button>
        <Button
          type="primary"
          onClick={() => {
            setShowCreateForm(v => !v);
            setShowCsvImport(false);
          }}
        >
          {showCreateForm
            ? t['Cancel']()
            : t['com.affine.admin.users.add']()}
        </Button>
      </div>

      {showCsvImport && <CsvImport onImported={fetchUsers} />}

      {showCreateForm && (
        <CreateUserForm
          onCreated={() => {
            setShowCreateForm(false);
            fetchUsers();
          }}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      <SettingWrapper
        title={t['com.affine.admin.users.count']({
          count: String(totalCount),
        })}
      >
        <div className={styles.userTable}>
          {users.length === 0 && !loading ? (
            <div className={styles.emptyState}>
              {t['com.affine.admin.users.empty']()}
            </div>
          ) : (
            users.map(user => (
              <div key={user.id} className={styles.userRow}>
                <Avatar
                  size={36}
                  rounded={4}
                  name={user.name || user.email}
                  url={user.avatarUrl || undefined}
                />
                <div className={styles.userInfo}>
                  <div className={styles.userName}>
                    {user.name || t['com.affine.admin.users.noName']()}
                  </div>
                  <div className={styles.userEmail}>{user.email}</div>
                </div>
                <div className={styles.userActions}>
                  {user.isAdmin && (
                    <span className={styles.adminBadge}>
                      {t['com.affine.admin.users.adminBadge']()}
                    </span>
                  )}
                  <Switch
                    checked={user.isAdmin}
                    onChange={(checked: boolean) =>
                      handleToggleAdmin(user.id, checked)
                    }
                  />
                  {/*
                    操作はメニューに畳む。行に直接ボタンを並べると、
                    ボタンの幅で**ユーザー名とメールアドレスが潰れて読めなくなる**。
                    ワークスペースのメンバー一覧（member-list.tsx）と同じ形。
                  */}
                  <Menu
                    items={
                      <>
                        <MenuItem
                          data-testid="admin-set-password"
                          onSelect={() => setPasswordTarget(user)}
                        >
                          {t['com.affine.admin.users.setPassword']()}
                        </MenuItem>
                        <MenuItem
                          data-testid="admin-reset-password"
                          disabled={issuingFor === user.id}
                          onSelect={() => handleIssueResetUrl(user)}
                        >
                          {t['com.affine.admin.users.resetPassword']()}
                        </MenuItem>
                        <MenuItem
                          data-testid="admin-delete-user"
                          type="danger"
                          onSelect={() => setDeleteTarget(user)}
                        >
                          {t['Delete']()}
                        </MenuItem>
                      </>
                    }
                  >
                    <IconButton
                      data-testid="admin-user-actions"
                      style={{ flexShrink: 0 }}
                    >
                      <MoreVerticalIcon />
                    </IconButton>
                  </Menu>
                </div>
              </div>
            ))
          )}
        </div>
      </SettingWrapper>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <span>
            {t['com.affine.admin.users.pagination']({
              page: String(page + 1),
              total: String(totalPages),
            })}
          </span>
          <div className={styles.paginationButtons}>
            <Button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
            >
              {t['com.affine.admin.users.previous']()}
            </Button>
            <Button
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
            >
              {t['com.affine.admin.users.next']()}
            </Button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title={t['com.affine.admin.users.delete.title']()}
        description={t['com.affine.admin.users.delete.desc']({
          email: deleteTarget?.email ?? '',
        })}
        onConfirm={handleDeleteUser}
        onOpenChange={(open: boolean) => {
          if (!open) setDeleteTarget(null);
        }}
        confirmText={t['Delete']()}
        confirmButtonOptions={{ variant: 'error' }}
      />

      {/* #115: パスワードの再設定（機能 3・直接変更） */}
      {passwordTarget && (
        <SetPasswordModal
          user={passwordTarget}
          onClose={() => setPasswordTarget(null)}
        />
      )}

      {/* #115: 発行した URL を表示する。閉じると再表示できない */}
      <ConfirmModal
        open={!!resetUrl}
        title={t['com.affine.admin.users.resetPassword.title']()}
        onOpenChange={(open: boolean) => {
          if (!open) setResetUrl(null);
        }}
        onConfirm={handleCopyResetUrl}
        confirmText={t['com.affine.admin.sso.copy']()}
        cancelText={t['Cancel']()}
      >
        <div className={styles.settingDesc}>
          {t['com.affine.admin.users.resetPassword.desc']({
            email: resetUrl?.user.email ?? '',
          })}
        </div>
        <code
          data-testid="admin-reset-password-url"
          className={styles.ssoRedirectUri}
        >
          {resetUrl?.url}
        </code>
        <div className={styles.settingDesc}>
          {t['com.affine.admin.users.resetPassword.warning']()}
        </div>
      </ConfirmModal>
    </>
  );
};

/**
 * #115: 管理者が対象ユーザーのパスワードを直接再設定する（機能 3）。
 *
 * 設定後、利用者は「設定 → アカウント → パスワードを変更」から自分で
 * 変更し直す運用を前提にする。変更を強制する仕組みは入れていない
 * （要望が出てから検討する）ため、運用でそう伝える必要がある。
 */
const SetPasswordModal = ({
  user,
  onClose,
}: {
  user: AdminUser;
  onClose: () => void;
}) => {
  const t = useI18n();
  const graphqlService = useService(GraphQLService);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (password.length < 8) {
      setError(t['com.affine.admin.users.form.error.passwordLength']());
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await graphqlService.gql({
        query: adminSetUserPasswordMutation,
        variables: { userId: user.id, password },
      } as any);
      notify.success({
        title: t['com.affine.admin.users.setPassword.done']({
          email: user.email,
        }),
      });
      onClose();
    } catch (e: any) {
      setError(e.message || t['com.affine.admin.users.setPassword.failed']());
    } finally {
      setSubmitting(false);
    }
  }, [graphqlService, password, user, onClose, t]);

  return (
    <ConfirmModal
      open
      title={t['com.affine.admin.users.setPassword.title']()}
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
      onConfirm={handleSubmit}
      confirmText={t['com.affine.admin.users.setPassword.confirm']()}
      cancelText={t['Cancel']()}
      confirmButtonOptions={{ disabled: submitting }}
    >
      <div className={styles.settingDesc}>
        {t['com.affine.admin.users.setPassword.desc']({ email: user.email })}
      </div>
      <input
        data-testid="admin-set-password-input"
        className={styles.formInput}
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        placeholder={t['com.affine.admin.users.form.passwordPlaceholder']()}
      />
      <div className={styles.settingDesc}>
        {t['com.affine.admin.users.setPassword.warning']()}
      </div>
      {error && (
        <div style={{ color: 'var(--affine-error-color)', fontSize: '13px' }}>
          {error}
        </div>
      )}
    </ConfirmModal>
  );
};

const CreateUserForm = ({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) => {
  const t = useI18n();
  const graphqlService = useService(GraphQLService);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!email || !password) {
      setError(t['com.affine.admin.users.form.error.required']());
      return;
    }
    if (password.length < 8) {
      setError(t['com.affine.admin.users.form.error.passwordLength']());
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await graphqlService.gql({
        query: adminCreateUserMutation,
        variables: {
          input: { email, password, name: name || undefined },
        },
      } as any);
      onCreated();
    } catch (e: any) {
      setError(
        e.message || t['com.affine.admin.users.form.error.createFailed']()
      );
    } finally {
      setSubmitting(false);
    }
  }, [graphqlService, email, password, name, onCreated, t]);

  return (
    <div className={styles.createUserForm}>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>
          {t['com.affine.admin.users.form.email']()}
        </label>
        <input
          className={styles.formInput}
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder={t['com.affine.admin.users.form.emailPlaceholder']()}
        />
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>
          {t['com.affine.admin.users.form.password']()}
        </label>
        <input
          className={styles.formInput}
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder={t['com.affine.admin.users.form.passwordPlaceholder']()}
        />
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>
          {t['com.affine.admin.users.form.name']()}
        </label>
        <input
          className={styles.formInput}
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t['com.affine.admin.users.form.namePlaceholder']()}
        />
      </div>
      {error && (
        <div style={{ color: 'var(--affine-error-color)', fontSize: '13px' }}>
          {error}
        </div>
      )}
      <div className={styles.formActions}>
        <Button onClick={onCancel}>{t['Cancel']()}</Button>
        <Button type="primary" onClick={handleSubmit} disabled={submitting}>
          {submitting
            ? t['com.affine.admin.users.form.creating']()
            : t['com.affine.admin.users.form.create']()}
        </Button>
      </div>
    </div>
  );
};
