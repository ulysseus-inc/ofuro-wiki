import { Avatar, Button, ConfirmModal, Switch, notify } from '@ofuro/component';
import { SettingHeader, SettingWrapper } from '@ofuro/component/setting-components';
import { GraphQLService } from '@ofuro/core/modules/cloud';
import { useI18n } from '@ofuro/i18n';
import {
  adminUserListQuery,
  adminCreateUserMutation,
  adminDeleteUserMutation,
  adminSetUserAdminMutation,
} from '@ofuro/graphql';
import { useService } from '@toeverything/infra';
import { useCallback, useEffect, useState } from 'react';

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
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
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

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <>
      <SettingHeader
        title={t['com.affine.admin.nav.users']()}
        subtitle={t['com.affine.admin.users.subtitle']()}
      />
      <div className={styles.searchBar}>
        <input
          className={styles.searchInput}
          placeholder={t['com.affine.admin.users.search']()}
          value={search}
          onChange={e => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <Button
          type="primary"
          onClick={() => setShowCreateForm(v => !v)}
        >
          {showCreateForm
            ? t['Cancel']()
            : t['com.affine.admin.users.add']()}
        </Button>
      </div>

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
                  <Button
                    type="error"
                    onClick={() => setDeleteTarget(user)}
                  >
                    {t['Delete']()}
                  </Button>
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
    </>
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
