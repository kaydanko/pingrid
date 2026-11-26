import { useCallback, useSyncExternalStore } from 'react';

/**
 * Shared wall clocks. Every component asking for the same granularity
 * subscribes to ONE timer, and ticks are aligned to wall-clock boundaries
 * (whole seconds, whole minutes), so a board of 40 tiles wakes the page once
 * per minute instead of 40 times at random offsets.
 */
interface Clock {
  now: number;
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setTimeout>;
}

const clocks = new Map<number, Clock>();

function clockFor(ms: number): Clock {
  let c = clocks.get(ms);
  if (!c) {
    c = { now: Date.now(), listeners: new Set() };
    clocks.set(ms, c);
  }
  return c;
}

function arm(ms: number, c: Clock) {
  // Next boundary, plus a few ms so we land just after it.
  const wait = ms - (Date.now() % ms) + 5;
  c.timer = setTimeout(() => {
    c.now = Date.now();
    c.listeners.forEach((l) => l());
    if (c.listeners.size) arm(ms, c);
    else c.timer = undefined;
  }, wait);
}

function subscribe(ms: number, listener: () => void) {
  const c = clockFor(ms);
  c.listeners.add(listener);
  if (!c.timer) {
    c.now = Date.now();
    arm(ms, c);
  }
  return () => {
    c.listeners.delete(listener);
    if (!c.listeners.size && c.timer) {
      clearTimeout(c.timer);
      c.timer = undefined;
    }
  };
}

/**
 * Current time, re-rendering on `ms` boundaries. Pass `null` to stop ticking:
 * the component then re-renders only for its own reasons.
 */
export function useNow(ms: number | null): number {
  // Stable per granularity, so React does not re-subscribe on every render.
  const sub = useCallback((l: () => void) => (ms ? subscribe(ms, l) : () => undefined), [ms]);
  const snap = useCallback(() => (ms ? clockFor(ms).now : 0), [ms]);
  // The subscription only decides WHEN to re-render. The value is read fresh,
  // because a clock joined late may hold a tick up to `ms` old (an outage
  // counter switching from 1 s to 15 s ticks must never jump backwards).
  useSyncExternalStore(sub, snap, snap);
  return Date.now();
}
