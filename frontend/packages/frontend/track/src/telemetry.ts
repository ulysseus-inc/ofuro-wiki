// ofuro-wiki: Telemetry completely disabled — no external data transmission.
// These types and no-op functions are kept only for API compatibility.

export type TelemetryEvent = {
  schemaVersion: 1;
  eventName: string;
  params?: Record<string, unknown>;
  userProperties?: Record<string, unknown>;
  userId?: string;
  clientId: string;
  sessionId?: string | number;
  eventId: string;
  timestampMicros?: number;
  context?: {
    appVersion?: string;
    editorVersion?: string;
    environment?: string;
    distribution?: string;
    channel?: 'stable' | 'beta' | 'internal' | 'canary';
    isDesktop?: boolean;
    isMobile?: boolean;
    locale?: string;
    timezone?: string;
    url?: string;
    referrer?: string;
  };
};

export type TelemetryContext = {
  isAuthed: boolean;
  isSelfHosted: boolean;
  channel: 'stable' | 'beta' | 'internal' | 'canary';
  userId?: string;
  userProperties?: Record<string, unknown>;
  officialEndpoint: string;
};

export type TelemetryAck =
  | { ok: true; accepted: number; dropped: number }
  | { ok: false; error: { name: string; message: string } };

export type TelemetryTransport = {
  setContext: (context: TelemetryContext) => Promise<void> | void;
  track: (event: TelemetryEvent) => Promise<{ queued: boolean }> | void;
  pageview?: (event: TelemetryEvent) => Promise<{ queued: boolean }> | void;
  flush?: () => Promise<TelemetryAck> | void;
};

// No-op implementations
export function setTelemetryTransport(_next: TelemetryTransport | null) {}
export function setTelemetryContext(
  _update: Partial<TelemetryContext>,
  _options?: { replaceUserProperties?: boolean }
) {}
export function getTelemetryContext(): TelemetryContext {
  return {
    isAuthed: false,
    isSelfHosted: true,
    channel: 'stable',
    officialEndpoint: '',
  };
}
export async function sendTelemetryEvent(
  _event: TelemetryEvent
): Promise<{ queued: boolean }> {
  return { queued: false };
}
export async function flushTelemetry(): Promise<TelemetryAck> {
  return { ok: true, accepted: 0, dropped: 0 };
}
