import {
  type AlertKind,
  type Detection,
  type IpCount,
  TOP_IP_LIMIT,
} from './alert.types';

/**
 * #117: 通知の文面（docs/intrusion-detection.md 3.4）。
 *
 * **深夜に届いてもその場で判断できるよう、対処の要約を本文に書く。**
 * 種別によって対処が異なるため、文面を分ける。
 *
 * 最初に書くのは「緊急度」と「侵入されたのか」。
 * 叩き起こされた人が最初に知りたいのはそこであり、
 * 数字の羅列を先に置くと読み飛ばされる。
 */

const DOC_LINK = '詳細: docs/deploy/README.md#攻撃を検知したときの対応';

/** 発信元を「上位3件 + ほかN件」に整形する。 */
export function formatIps(ips: IpCount[]): string {
  if (ips.length === 0) return '不明';

  const top = ips.slice(0, TOP_IP_LIMIT);
  const rest = ips.length - top.length;
  const head = top.map((i) => `${i.ip} (${i.count}回)`).join(', ');
  return rest > 0 ? `${head}, ほか ${rest} IP` : head;
}

const SUBJECTS: Record<AlertKind, string> = {
  A: 'ofuro-wiki: 不審なログイン試行を検知しました',
  B: 'ofuro-wiki: 広範囲へのログイン試行を検知しました',
  C: 'ofuro-wiki: 大量のログイン要求を検知しました',
  D: 'ofuro-wiki: 存在しないアカウントへの試行を検知しました',
};

const KIND_LABELS: Record<AlertKind, string> = {
  A: '同一アカウントへの集中攻撃',
  B: 'パスワードスプレー攻撃の可能性',
  C: '総当たり攻撃 / DoS の可能性',
  D: 'アカウント列挙（偵察）の可能性',
};

export function alertSubject(kind: AlertKind): string {
  return SUBJECTS[kind];
}

export function kindLabel(kind: AlertKind): string {
  return KIND_LABELS[kind];
}

/** 検知通知の本文（プレーンテキスト）。 */
export function alertBody(d: Detection, windowMinutes: number): string {
  const header = [
    `🚨 ${SUBJECTS[d.kind]}`,
    '',
    `種別  : ${KIND_LABELS[d.kind]}`,
  ];

  if (d.targetEmail) header.push(`対象  : ${d.targetEmail}`);
  header.push(`状況  : ${situation(d, windowMinutes)}`);
  header.push(`発信元: ${formatIps(d.ips)}`);

  return [...header, '', ADVICE[d.kind], DOC_LINK].join('\n');
}

/**
 * 「状況」の1行。
 *
 * ⚠️ 種別Bは**アカウント数と総回数の両方**を書く。
 * 「24アカウント」だけでは、1アカウントあたり1回なのか100回なのかが分からず、
 * 偵察なのか本気の総当たりなのか判断できない。
 */
function situation(d: Detection, windowMinutes: number): string {
  const w = `直近${windowMinutes}分に`;
  switch (d.kind) {
    case 'A':
      return `${w} ${d.observed} 回ロック`;
    case 'B':
      return `${w} ${d.accounts} アカウントでログイン失敗（合計 ${d.totalFailures} 回）`;
    case 'C':
      return `${w} ${d.observed} 回のレート制限（429）が発生`;
    case 'D':
      return `${w} ${d.observed} 回、存在しないアドレスへの試行`;
  }
}

const ADVICE: Record<AlertKind, string> = {
  A: [
    '▼ 対処の目安',
    '1. 緊急度: 中（ロックが効いています。侵入はされていません）',
    '2. 攻撃元IPが偏っている場合 → リバースプロキシ(Caddy/Nginx)で遮断',
    '3. 対象ユーザーに連絡し、パスワードを変更してもらう',
    '   （推測されやすいパスワードを使っていないか確認）',
    '4. 攻撃が続く場合 → SSO に切り替え、パスワード認証を止める',
    '',
    '※ 本人が繰り返し打ち間違えただけの可能性もあります。',
    '   まず対象ユーザーに心当たりがないか確認してください。',
  ].join('\n'),

  B: [
    '▼ 対処の目安',
    '1. 緊急度: 高（アカウントロックが発生しないため気づきにくい攻撃です）',
    '2. 攻撃元IPをリバースプロキシ / ファイアウォールで遮断',
    '3. 公開範囲を見直す（VPN 内に閉じる・IP 制限をかける）',
    '4. 弱いパスワードのアカウントが侵入される恐れ →',
    '   SSO への切り替えを強く推奨',
    '',
    '※ 「1アカウントあたり数回」なので、個別のロックは発生しません。',
  ].join('\n'),

  C: [
    '▼ 対処の目安',
    '1. 緊急度: 中（レート制限で防いでいますが、負荷がかかっています）',
    '2. 攻撃元IPをリバースプロキシ / ファイアウォールで遮断',
    '3. サーバーの負荷（CPU・レスポンス）を確認',
    '4. 継続する場合はサインアップを閉じる、一時的に公開を停止',
    '',
    '※ パスワードの照合まで到達していないため、突破はされていません。',
  ].join('\n'),

  D: [
    '▼ 対処の目安',
    '1. 緊急度: 低（存在しないアカウントへの試行です。突破はされていません）',
    '2. 攻撃の下調べ（アカウント列挙）である可能性があります。',
    '   本番の攻撃が続くことがあるため、しばらく様子を見てください',
    '3. 攻撃元IPが偏っている場合 → リバースプロキシで遮断',
    '4. 公開範囲を見直す（VPN 内に閉じる・IP 制限をかける）',
    '',
    '※ 社内の誰かが古いアドレスでログインを試みただけの可能性もあります。',
  ].join('\n'),
};

/** 終息通知の本文。 */
export function resolvedBody(
  kind: AlertKind,
  targetEmail: string | undefined,
  detectedAt: Date,
  quietMinutes: number,
): string {
  const lines = [
    '✅ ofuro-wiki: 不審なログイン試行は収まりました',
    '',
    `種別  : ${KIND_LABELS[kind]}`,
  ];
  if (targetEmail) lines.push(`対象  : ${targetEmail}`);
  lines.push(
    `経過  : ${formatTime(detectedAt)} に検知 → 直近 ${quietMinutes} 分は該当なし`,
    '',
    '対応が不要だった場合でも、監査ログで経緯を確認できます。',
  );
  return lines.join('\n');
}

export function resolvedSubject(): string {
  return 'ofuro-wiki: 不審なログイン試行は収まりました';
}

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
