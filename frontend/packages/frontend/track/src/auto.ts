// ofuro-wiki: Telemetry completely disabled — no external data transmission.

import type { CallableEventsChain } from './types';

interface TrackFn {
  (event: string, props: Record<string, any>): void;
}

const levels = ['page', 'segment', 'module', 'event'] as const;
export function makeTracker(trackFn: TrackFn): CallableEventsChain {
  function makeTrackerInner(level: number, info: Record<string, string>) {
    const proxy = new Proxy({} as Record<string, any>, {
      get(target, prop) {
        if (
          typeof prop !== 'string' ||
          prop === '$$typeof'
        ) {
          return undefined;
        }

        if (levels[level] === 'event') {
          return (_arg: string | Record<string, any>) => {};
        } else {
          let levelProxy = target[prop];
          if (levelProxy) {
            return levelProxy;
          }

          levelProxy = makeTrackerInner(
            level + 1,
            prop === '$' ? { ...info } : { ...info, [levels[level]]: prop }
          );
          target[prop] = levelProxy;
          return levelProxy;
        }
      },
    });

    return proxy;
  }

  return makeTrackerInner(0, {}) as CallableEventsChain;
}

export function enableAutoTrack(_root: HTMLElement, _trackFn: TrackFn) {
  return () => {};
}

declare module 'react' {
  interface HTMLAttributes<T> {
    'data-event-props'?: string;
    'data-event-arg'?: string;
    'data-event-args-control'?: string;
  }
}
