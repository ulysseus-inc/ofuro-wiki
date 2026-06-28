// ofuro-wiki: Telemetry disabled for self-hosted deployment
// tracker.init() and sentry.init() are intentionally not called.
// All track.$ calls throughout the codebase become no-ops.

// Remove any telemetry artifacts from localStorage (cleanup for existing installs)
try {
  const TELEMETRY_KEYS = [
    'affine_telemetry_client_id',
    'affine_telemetry_session_id',
    'affine_telemetry_session_number',
    'affine_telemetry_session_number_current',
    'affine_telemetry_last_activity_ms',
  ];
  for (const key of TELEMETRY_KEYS) {
    localStorage.removeItem(key);
  }
} catch {
  // localStorage unavailable (e.g. private browsing) — ignore
}
