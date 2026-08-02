import { Button, Modal, notify } from '@ofuro/component';
import {
  SettingHeader,
  SettingWrapper,
} from '@ofuro/component/setting-components';
import { GraphQLService } from '@ofuro/core/modules/cloud';
import {
  adminAuditLogsCsvQuery,
  adminAuditLogsQuery,
} from '@ofuro/graphql';
import { useI18n } from '@ofuro/i18n';
import { useService } from '@toeverything/infra';
import { useCallback, useEffect, useRef, useState } from 'react';

import * as styles from './style.css';

interface AuditLogItem {
  id: string;
  createdAt: string;
  action: string;
  actorEmail: string;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  ip: string | null;
  detail: unknown;
}

const PAGE_SIZE = 50;

/**
 * 日付入力（`2026-08-02`）を、**利用者の時間帯**の1日の始まり／終わりに変換する。
 *
 * ⚠️ `new Date('2026-08-02')` は **UTC の 0時**として解釈される。
 * JST(+9) では「その日の朝9時」を意味するため、**午前0時〜9時の記録が
 * まるごと落ちる**（実際に「今日」で絞って1件も出ない事象が起きた）。
 * 画面の日付は利用者の時間帯で解釈しなければ、結果が理解できないものになる。
 */
function localDayStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

function localDayEnd(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

/**
 * #90: 監査ログの閲覧（Admin のみ）。
 *
 * 一覧は日時・実行者・操作・対象に絞り、`detail` は詳細で整形して見せる。
 * 一覧に生の JSON を並べても読めないため（docs/logging.md 2.10）。
 */
export const AuditLogPanel = () => {
  const t = useI18n();
  /**
   * 操作名を利用者の言語で表示する。
   * `user.password.reset.token` のままでは、何が起きたのか読み取れない。
   * 翻訳が無い操作（今後追加されるもの）は、生の値をそのまま出す。
   */
  const actionLabel = useCallback(
    (value: string) => {
      const key = `com.affine.admin.audit.action.${value}`;
      // i18n は Proxy 実装で未知のキーでも関数を返すが、そこに依存しない書き方にする。
      // 翻訳が無い場合はキー文字列がそのまま返るため、値を比べて生の action に戻す。
      // **1つの未知の操作で画面全体が落ちてはいけない。**
      const translated = t[key]?.() ?? value;
      return translated === key ? value : translated;
    },
    [t]
  );
  const graphqlService = useService(GraphQLService);
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<AuditLogItem | null>(null);
  const [loading, setLoading] = useState(false);
  /** 取得に失敗したか。監査ログは「無い」と「取れない」を混同してはいけない。 */
  const [failed, setFailed] = useState(false);

  const variables = useCallback(
    () => ({
      actor: actor || undefined,
      action: action || undefined,
      from: from ? localDayStart(from) : undefined,
      // 終了日は「その日を含む」ようにする。日付だけの指定だと 00:00 になり、
      // その日の記録が1件も出ないため（利用者には理解できない挙動になる）
      to: to ? localDayEnd(to) : undefined,
    }),
    [actor, action, from, to]
  );

  /**
   * 応答の世代。**遅れて返ってきた古い応答で新しい結果を上書きしない**ため。
   * 絞り込みを続けて変えると、応答の順序は入れ替わりうる。
   */
  const requestId = useRef(0);

  const fetchLogs = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    try {
      const result = await graphqlService.gql({
        query: adminAuditLogsQuery,
        variables: { ...variables(), skip: page * PAGE_SIZE, take: PAGE_SIZE },
      } as any);
      if (current !== requestId.current) return;
      setItems((result as any).adminAuditLogs.items);
      setTotalCount((result as any).adminAuditLogs.totalCount);
      setFailed(false);
    } catch (e) {
      // ⚠️ 前回の結果を残したまま黙って失敗すると、**取得できなかったのに
      // 「該当する記録がありません」と読めてしまう**。監査ログでは
      // 「記録が無い」と「取れていない」を取り違えさせてはいけない。
      console.error('Failed to fetch audit logs:', e);
      if (current !== requestId.current) return;
      setItems([]);
      setTotalCount(0);
      setFailed(true);
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [graphqlService, page, variables]);

  useEffect(() => {
    // ⚠️ 打鍵のたびに問い合わせない。実行者の絞り込みは部分一致で、
    // 3年ぶん（225万行想定）を毎回検索することになる。
    const timer = setTimeout(() => {
      fetchLogs();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchLogs]);

  const handleExport = useCallback(async () => {
    try {
      const result = await graphqlService.gql({
        query: adminAuditLogsCsvQuery,
        variables: variables(),
      } as any);
      // Excel が UTF-8 と判別できるよう BOM を付ける
      const blob = new Blob([`﻿${(result as any).adminAuditLogsCsv}\n`], {
        type: 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      // click() の直後に revoke すると、ブラウザによっては保存が始まる前に
      // URL が無効化され、ダウンロードが取り消される。次のタスクまで待つ
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e: any) {
      notify.error({
        title: t['com.affine.admin.audit.exportFailed'](),
        message: e?.message ? String(e.message) : undefined,
      });
    }
  }, [graphqlService, t, variables]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <>
      <SettingHeader
        title={t['com.affine.admin.nav.audit']()}
        subtitle={t['com.affine.admin.audit.subtitle']()}
      />

      <div className={styles.searchBar}>
        <input
          data-testid="audit-filter-actor"
          className={styles.searchInput}
          placeholder={t['com.affine.admin.audit.filter.actor']()}
          value={actor}
          onChange={e => {
            setActor(e.target.value);
            setPage(0);
          }}
        />
        <input
          data-testid="audit-filter-action"
          className={styles.searchInput}
          placeholder={t['com.affine.admin.audit.filter.action']()}
          value={action}
          onChange={e => {
            setAction(e.target.value);
            setPage(0);
          }}
        />
        <div className={styles.dateRange}>
          <span className={styles.dateRangeLabel}>
            {t['com.affine.admin.audit.filter.period']()}
          </span>
          <input
            data-testid="audit-filter-from"
            className={styles.dateInput}
            type="date"
            aria-label={t['com.affine.admin.audit.filter.from']()}
            value={from}
            onChange={e => {
              setFrom(e.target.value);
              setPage(0);
            }}
          />
          <span className={styles.dateRangeLabel}>〜</span>
          <input
            data-testid="audit-filter-to"
            className={styles.dateInput}
            type="date"
            aria-label={t['com.affine.admin.audit.filter.to']()}
            value={to}
            onChange={e => {
              setTo(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <Button data-testid="audit-export" onClick={handleExport}>
          {t['com.affine.admin.audit.export']()}
        </Button>
      </div>

      <SettingWrapper
        title={t['com.affine.admin.audit.count']({ count: String(totalCount) })}
      >
        <div className={styles.userTable} data-testid="audit-log-list">
          {failed ? (
            <div
              className={styles.emptyState}
              style={{ color: 'var(--affine-error-color)' }}
              data-testid="audit-load-failed"
            >
              {t['com.affine.admin.audit.loadFailed']()}
            </div>
          ) : items.length === 0 && !loading ? (
            <div className={styles.emptyState}>
              {t['com.affine.admin.audit.empty']()}
            </div>
          ) : (
            items.map(item => (
              <div
                key={item.id}
                className={styles.userRow}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(item)}
              >
                <div className={styles.userInfo}>
                  <div className={styles.userName}>
                    {actionLabel(item.action)}
                    {item.targetName ? ` → ${item.targetName}` : ''}
                  </div>
                  <div className={styles.userEmail}>
                    {new Date(item.createdAt).toLocaleString()}
                    {' / '}
                    {item.actorName
                      ? `${item.actorName} (${item.actorEmail})`
                      : item.actorEmail}
                    {item.ip ? ` / ${item.ip}` : ''}
                  </div>
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
            <Button disabled={page === 0} onClick={() => setPage(p => p - 1)}>
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

      {/* 詳細。detail は整形して見せる（1行の JSON は読めない） */}
      <Modal
        open={!!selected}
        onOpenChange={(open: boolean) => {
          if (!open) setSelected(null);
        }}
        title={selected ? actionLabel(selected.action) : undefined}
      >
        {selected && (
          <div data-testid="audit-detail">
            <div className={styles.settingDesc}>
              {t['com.affine.admin.audit.detail.actor']()}:{' '}
              {selected.actorName
                ? `${selected.actorName} (${selected.actorEmail})`
                : selected.actorEmail}
            </div>
            <div className={styles.settingDesc}>
              {t['com.affine.admin.audit.detail.time']()}:{' '}
              {new Date(selected.createdAt).toLocaleString()}
            </div>
            {selected.targetName || selected.targetId ? (
              <div className={styles.settingDesc}>
                {t['com.affine.admin.audit.detail.target']()}:{' '}
                {selected.targetName ?? selected.targetId}
              </div>
            ) : null}
            {selected.ip ? (
              <div className={styles.settingDesc}>IP: {selected.ip}</div>
            ) : null}
            {selected.detail ? (
              <code className={styles.csvExample}>
                {JSON.stringify(selected.detail, null, 2)}
              </code>
            ) : null}
          </div>
        )}
      </Modal>
    </>
  );
};
