import { MINUTE_MS } from './durations';

export interface SharedClock {
  subscribe(listener: () => void): () => void;
  getSnapshot(): number;
}

export interface SharedClockOptions {
  intervalMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export interface TestableSharedClock extends SharedClock {
  subscriberCount(): number;
}

export function createSharedClock(options: SharedClockOptions = {}): TestableSharedClock {
  const {
    intervalMs = MINUTE_MS,
    now = Date.now,
    setTimer = (fn, ms) => setInterval(fn, ms),
    clearTimer = (id) => clearInterval(id as ReturnType<typeof setInterval>),
  } = options;

  const listeners = new Set<() => void>();
  let current = now();
  let timerId: unknown = null;

  const tick = () => {
    current = now();
    listeners.forEach((listener) => listener());
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (timerId === null) {
        current = now();
        timerId = setTimer(tick, intervalMs);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timerId !== null) {
          clearTimer(timerId);
          timerId = null;
        }
      };
    },
    getSnapshot() {
      return current;
    },
    subscriberCount() {
      return listeners.size;
    },
  };
}

export const MINUTE_CLOCK: SharedClock = createSharedClock();
