/**
 * #117: 検知の設定（docs/intrusion-detection.md 6章）。
 *
 * しきい値は**社内 Wiki の規模を想定した初期値**。運用しながら調整する。
 * 管理画面には出さない（サーバー全体の設定であり、運用者がデプロイ時に決めるもの）。
 */

export interface AlertConfig {
  /** 集計の窓（分）。全種別で共通。 */
  windowMinutes: number;
  /** 終息と判定するまでの静穏時間（分）。 */
  quietMinutes: number;
  lockThreshold: number;
  sprayAccountThreshold: number;
  throttleThreshold: number;
  unknownEmailThreshold: number;
  disabled: boolean;
}

export const ALERT_DEFAULTS: Omit<AlertConfig, 'disabled'> = {
  windowMinutes: 60,
  quietMinutes: 30,
  lockThreshold: 3,
  sprayAccountThreshold: 20,
  throttleThreshold: 100,
  unknownEmailThreshold: 50,
};

/**
 * 正の整数として読む。読めない値は既定値に倒す。
 *
 * ⚠️ **0 や負数を受け付けてはいけない。** しきい値 0 は「常に検知」を意味し、
 * 5分ごとに通知が飛び続ける。設定ミスで通知が使いものにならなくなるより、
 * 既定値で動き続ける方がよい。
 */
export function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

export function loadAlertConfig(
  env: NodeJS.ProcessEnv = process.env,
): AlertConfig {
  return {
    windowMinutes: positiveInt(
      env.ALERT_WINDOW_MINUTES,
      ALERT_DEFAULTS.windowMinutes,
    ),
    quietMinutes: positiveInt(
      env.ALERT_RESOLVE_QUIET_MINUTES,
      ALERT_DEFAULTS.quietMinutes,
    ),
    lockThreshold: positiveInt(
      env.ALERT_LOCK_THRESHOLD,
      ALERT_DEFAULTS.lockThreshold,
    ),
    sprayAccountThreshold: positiveInt(
      env.ALERT_SPRAY_ACCOUNT_THRESHOLD,
      ALERT_DEFAULTS.sprayAccountThreshold,
    ),
    throttleThreshold: positiveInt(
      env.ALERT_THROTTLE_THRESHOLD,
      ALERT_DEFAULTS.throttleThreshold,
    ),
    unknownEmailThreshold: positiveInt(
      env.ALERT_UNKNOWN_EMAIL_THRESHOLD,
      ALERT_DEFAULTS.unknownEmailThreshold,
    ),
    disabled: env.ALERT_DISABLED === 'true',
  };
}
