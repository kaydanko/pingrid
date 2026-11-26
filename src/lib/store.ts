/**
 * Tiny external store (useSyncExternalStore) with debounced persistence.
 * No state library needed for an app this size.
 */
import { useSyncExternalStore } from 'react';
import type { Resource, ResourceStatus, Settings } from '../types';
import { DEFAULT_SETTINGS, emptyStatus, normalizeSettings } from './defaults';
import { getStorage, type StorageAdapter } from '../platform/storageAdapter';
import type { ProxyStatus } from '../platform/networkChecker';
import { normalizeUrl } from './importExport';

export interface AppState {
  ready: boolean;
  storageKind: StorageAdapter['kind'] | null;
  /** Browser build with a proxy: is the proxy answering? null until the first call. */
  proxyStatus: ProxyStatus | null;
  resources: Resource[];
  settings: Settings;
  statuses: Record<string, ResourceStatus>;
}

let state: AppState = {
  ready: false,
  storageKind: null,
  proxyStatus: null,
  resources: [],
  settings: DEFAULT_SETTINGS,
  statuses: {},
};
const listeners = new Set<() => void>();

export const getState = () => state;

export function setState(next: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const patch = typeof next === 'function' ? next(state) : next;
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

/* -------------------------------- actions ------------------------------- */

const sameValue = (a: unknown, b: unknown) =>
  Object.is(a, b) ||
  (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i])));

function isNoop<T extends object>(cur: T, patch: Partial<T>): boolean {
  return (Object.keys(patch) as (keyof T)[]).every((k) => sameValue(cur[k], patch[k]));
}

export const actions = {
  addResources(list: Resource[]) {
    setState((s) => ({
      resources: [...s.resources, ...list],
      statuses: { ...s.statuses, ...Object.fromEntries(list.map((r) => [r.id, emptyStatus()])) },
    }));
  },
  updateResource(id: string, patch: Partial<Resource>) {
    setState((s) => {
      const prev = s.resources.find((r) => r.id === id);
      const urlChanged = prev && patch.url !== undefined && normalizeUrl(patch.url) !== normalizeUrl(prev.url);
      return {
        resources: s.resources.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        // A new URL is a new target: forget old latency, outage and certificate.
        statuses: urlChanged ? { ...s.statuses, [id]: emptyStatus() } : s.statuses,
      };
    });
  },
  removeResource(id: string) {
    setState((s) => {
      const { [id]: _gone, ...rest } = s.statuses;
      void _gone;
      return { resources: s.resources.filter((r) => r.id !== id), statuses: rest };
    });
  },
  replaceResources(list: Resource[]) {
    setState({ resources: list, statuses: Object.fromEntries(list.map((r) => [r.id, emptyStatus()])) });
  },
  setSettings(patch: Partial<Settings> | ((s: Settings) => Settings)) {
    setState((s) => ({ settings: typeof patch === 'function' ? patch(s.settings) : { ...s.settings, ...patch } }));
  },
  patchStatus(id: string, patch: Partial<ResourceStatus> | ((st: ResourceStatus) => Partial<ResourceStatus>)) {
    const s = state;
    if (!s.resources.some((r) => r.id === id)) return;
    const cur = s.statuses[id] ?? emptyStatus();
    const p = typeof patch === 'function' ? patch(cur) : patch;
    // No-op patches (e.g. SSL rules re-confirming the same alert keys on every
    // check) must not re-render the board or schedule a database write.
    if (s.statuses[id] && isNoop(cur, p)) return;
    setState({ statuses: { ...s.statuses, [id]: { ...cur, ...p } } });
  },
  async clearAll() {
    const storage = await getStorage();
    await storage.clear();
    setState({ resources: [], statuses: {}, settings: { ...DEFAULT_SETTINGS, lang: state.settings.lang, theme: state.settings.theme } });
  },
};

/* ------------------------------ persistence ----------------------------- */

const K_SETTINGS = 'settings';
const K_STATUSES = 'statuses';

export async function hydrate(): Promise<void> {
  const storage = await getStorage();
  const [resources, settings, statuses] = await Promise.all([
    storage.loadResources().catch(() => [] as Resource[]),
    storage.getKV<Settings>(K_SETTINGS).catch(() => undefined),
    storage.getKV<Record<string, ResourceStatus>>(K_STATUSES).catch(() => undefined),
  ]);
  const restored: Record<string, ResourceStatus> = {};
  for (const r of resources) {
    const st = statuses?.[r.id];
    // Transient flags never survive a restart.
    restored[r.id] = st ? { ...emptyStatus(), ...st, checking: false, confirming: false } : emptyStatus();
  }
  setState({
    ready: true,
    storageKind: storage.kind,
    resources,
    settings: normalizeSettings(settings),
    statuses: restored,
  });
  startPersistence(storage);
}

/** Run at most once per `ms`, trailing. Unlike debounce, a steady stream of calls cannot postpone it forever. */
function throttle(fn: () => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (t) return;
    t = setTimeout(() => {
      t = undefined;
      fn();
    }, ms);
  };
  run.flush = () => {
    if (!t) return;
    clearTimeout(t);
    t = undefined;
    fn();
  };
  return run;
}

function debounce(fn: () => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
  run.flush = () => {
    clearTimeout(t);
    fn();
  };
  return run;
}

function startPersistence(storage: StorageAdapter) {
  let last = state;
  const saveResources = debounce(() => {
    storage.saveResources(state.resources).catch((e) => console.error('[pingrid] save resources', e));
  }, 300);
  const saveSettings = debounce(() => {
    storage.setKV(K_SETTINGS, state.settings).catch((e) => console.error('[pingrid] save settings', e));
  }, 300);
  // Statuses change on every check. They are only needed to restore the board
  // and the alert bookkeeping after a restart, so write at most every 30 s.
  const saveStatuses = throttle(() => {
    storage.setKV(K_STATUSES, state.statuses).catch((e) => console.error('[pingrid] save statuses', e));
  }, 30_000);

  subscribe(() => {
    if (state.resources !== last.resources) saveResources();
    if (state.settings !== last.settings) saveSettings();
    if (state.statuses !== last.statuses) saveStatuses();
    last = state;
  });
  const flush = () => saveStatuses.flush();
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
}
