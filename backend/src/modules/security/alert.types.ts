/**
 * #117: 検知の種別・深刻度・集計結果の型（docs/intrusion-detection.md 2章）。
 */

/** 検知の種別。 */
export type AlertKind = 'A' | 'B' | 'C' | 'D';

/**
 * 深刻度。**メール本文の「緊急度」と同じ判断に揃える**
 * （画面と本文で食い違うと、どちらを信じるか迷う）。
 *
 * ⚠️ `CRITICAL` は「実際に突破された」を検知できるようになったときのために空けてある。
 * **後から段階を増やすと、過去に記録した security.alert の意味が変わる。**
 */
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const SEVERITY_OF: Record<AlertKind, Severity> = {
  // ロックが効いている＝防げている
  A: 'MEDIUM',
  // ロックが発生しないまま進行し、弱いパスワードが破られうる
  B: 'HIGH',
  // レート制限が弾いている＝防げている
  C: 'MEDIUM',
  // 存在しないアカウントなので突破されようがない
  D: 'LOW',
};

/** メール送信の結果。**真偽値では足りない**（disabled と failed は対処が違う）。 */
export type MailStatus = 'success' | 'disabled' | 'failed';

/** 通知に出す発信元は上位3件まで。100件並べても人間は読まない。 */
export const TOP_IP_LIMIT = 3;

/** 監査ログに残す対象アカウントの例。**全件は残さない**（攻撃対象一覧を作る意味がない）。 */
export const SAMPLE_ACCOUNT_LIMIT = 5;

export interface IpCount {
  ip: string;
  count: number;
}

/** 検知1件ぶんの内容。 */
export interface Detection {
  kind: AlertKind;
  /** 種別Aのみ。ロックされたアカウント。 */
  targetEmail?: string;
  targetUserId?: string;
  /** しきい値と、実際に観測した値。 */
  threshold: number;
  observed: number;
  /** 種別Bのみ。「広さ」と「深さ」を両方持つ（docs/intrusion-detection.md 3.5）。 */
  accounts?: number;
  totalFailures?: number;
  sampleAccounts?: string[];
  /** 件数の多い順。呼び出し側が TOP_IP_LIMIT で絞る。 */
  ips: IpCount[];
}

/** 検知の一意キー。抑制と終息の突き合わせに使う。 */
export function detectionKey(kind: AlertKind, targetEmail?: string): string {
  return targetEmail ? `${kind}:${targetEmail}` : kind;
}
