import { Button, notify } from '@ofuro/component';
import { GraphQLService } from '@ofuro/core/modules/cloud';
import {
  adminImportUsersMutation,
  adminValidateUserCsvMutation,
} from '@ofuro/graphql';
import { useI18n } from '@ofuro/i18n';
import { useService } from '@toeverything/infra';
import { useCallback, useRef, useState } from 'react';

import * as styles from './style.css';

interface RowResult {
  line: number;
  email: string;
  name: string | null;
  ok: boolean;
  error: string | null;
}

interface ImportResult {
  rows: RowResult[];
  okCount: number;
  ngCount: number;
}

/** テンプレートはサーバーを介さずフロントで作る（内容が静的なため）。 */
const TEMPLATE_CSV = [
  'email,name,password',
  'taro@example.com,山田 太郎,ChangeMe2026!',
  'hanako@example.com,鈴木 花子,ChangeMe2026!',
].join('\n');

/**
 * #92: ユーザーの CSV 一括登録。
 *
 * **確認してから登録する2段階**にしている。アップロードした時点では検証だけを行い、
 * 行ごとの OK / NG を見せる。登録後に失敗行を報告する方式だと後始末が発生するため。
 */
export const CsvImport = ({ onImported }: { onImported: () => void }) => {
  const t = useI18n();
  const graphqlService = useService(GraphQLService);
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [imported, setImported] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      // 文字コードは UTF-8 前提。BOM の除去はサーバー側で行う。
      const text = await file.text();
      setCsv(text);
      setFileName(file.name);
      setResult(null);
      setImported(false);
      setBusy(true);
      try {
        const res = await graphqlService.gql({
          query: adminValidateUserCsvMutation,
          variables: { csv: text },
        } as any);
        setResult((res as any).adminValidateUserCsv);
      } catch (e: any) {
        // CSV 全体の書式エラー（email 列が無い等）はここに来る
        notify.error({
          title: t['com.affine.admin.users.csv.invalidFile'](),
          message: e?.message ? String(e.message) : undefined,
        });
        setCsv(null);
        setFileName('');
      } finally {
        setBusy(false);
      }
    },
    [graphqlService, t]
  );

  const handleImport = useCallback(async () => {
    if (!csv) return;
    setBusy(true);
    try {
      const res = await graphqlService.gql({
        query: adminImportUsersMutation,
        variables: { csv },
      } as any);
      const imported = (res as any).adminImportUsers as ImportResult;
      setResult(imported);
      setImported(true);
      notify.success({
        title: t['com.affine.admin.users.csv.done']({
          count: String(imported.okCount),
        }),
      });
      onImported();
    } catch (e: any) {
      notify.error({
        title: t['com.affine.admin.users.csv.failed'](),
        message: e?.message ? String(e.message) : undefined,
      });
    } finally {
      setBusy(false);
    }
  }, [csv, graphqlService, onImported, t]);

  const downloadTemplate = useCallback(() => {
    // Excel が UTF-8 と判別できるよう BOM を付ける（付けないと日本語が化ける）
    const blob = new Blob([`﻿${TEMPLATE_CSV}\n`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ofuro-wiki-users-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className={styles.createUserForm}>
      <div className={styles.settingDesc}>
        {t['com.affine.admin.users.csv.format']()}
      </div>
      <code className={styles.csvExample}>{TEMPLATE_CSV}</code>
      <div className={styles.settingDesc}>
        {t['com.affine.admin.users.csv.rules']()}
      </div>

      <div className={styles.formActions}>
        <Button data-testid="admin-csv-template" onClick={downloadTemplate}>
          {t['com.affine.admin.users.csv.template']()}
        </Button>
        <Button
          data-testid="admin-csv-choose"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {fileName || t['com.affine.admin.users.csv.choose']()}
        </Button>
        <input
          ref={fileRef}
          data-testid="admin-csv-file"
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0];
            // 同じファイルを選び直せるようにする（直して再アップロードする流れのため）
            e.target.value = '';
            if (file) handleFile(file);
          }}
        />
      </div>

      {result && (
        <>
          <div className={styles.settingDesc} data-testid="admin-csv-summary">
            {imported
              ? t['com.affine.admin.users.csv.resultDone']({
                  ok: String(result.okCount),
                  ng: String(result.ngCount),
                })
              : t['com.affine.admin.users.csv.resultCheck']({
                  ok: String(result.okCount),
                  ng: String(result.ngCount),
                })}
          </div>
          <div className={styles.userTable} data-testid="admin-csv-rows">
            {result.rows.map(row => (
              <div key={row.line} className={styles.userRow}>
                <div className={styles.userInfo}>
                  <div className={styles.userName}>
                    {t['com.affine.admin.users.csv.line']({
                      line: String(row.line),
                    })}
                    {row.email ? ` ${row.email}` : ''}
                  </div>
                  {row.error && (
                    <div
                      className={styles.userEmail}
                      style={{ color: 'var(--affine-error-color)' }}
                    >
                      {row.error}
                    </div>
                  )}
                </div>
                <span
                  className={row.ok ? styles.csvOkBadge : styles.csvNgBadge}
                >
                  {row.ok
                    ? t['com.affine.admin.users.csv.ok']()
                    : t['com.affine.admin.users.csv.ng']()}
                </span>
              </div>
            ))}
          </div>
          {!imported && (
            <div className={styles.formActions}>
              <Button
                data-testid="admin-csv-import"
                type="primary"
                disabled={busy || result.okCount === 0}
                onClick={handleImport}
              >
                {t['com.affine.admin.users.csv.import']({
                  count: String(result.okCount),
                })}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
