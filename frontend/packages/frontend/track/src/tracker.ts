// ofuro-wiki: Telemetry completely disabled — no external data transmission.
// tracker is a no-op stub for API compatibility.

export const tracker = {
  init() {},
  register(_props: Record<string, unknown>) {},
  reset() {},
  track(_eventName: string, _properties?: Record<string, unknown> | object) {},
  track_pageview(
    _properties?: { location?: string; [key: string]: unknown }
  ) {},
  middleware(_cb: (name: string, props?: Record<string, unknown>) => Record<string, unknown>): () => void {
    return () => {};
  },
  opt_out_tracking() {},
  opt_in_tracking() {},
  has_opted_in_tracking() {
    return false;
  },
  has_opted_out_tracking() {
    return true;
  },
  identify(_nextUserId?: string) {},
  get people() {
    return {
      set: (_props: Record<string, unknown>) => {},
    };
  },
};
