import type { ResourceStatus, Settings } from '../types';

export const DEFAULT_SETTINGS: Settings = {
  lang: 'uk',
  theme: 'dark',
  intervalSec: 60,
  timeoutMs: 10_000,
  prioritySort: true,
  keepAwake: true,
  sslThresholds: [30, 14, 7, 3, 1],
  suppressEarlyForAuto: true,
  autoRenewUrgentDays: 5,
  sslWarnDays: 14,
  notify: {
    os: true,
    sound: false,
    telegram: { enabled: false, botToken: '', chatId: '' },
    webhook: { enabled: false, url: '' },
  },
  webProxyUrl: '',
};

/** Merge stored/imported settings over defaults, dropping unknown shapes. */
export function normalizeSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const d = DEFAULT_SETTINGS;
  const n = (s.notify ?? {}) as Partial<Settings['notify']>;
  const num = (v: unknown, def: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  return {
    lang: s.lang === 'en' || s.lang === 'uk' ? s.lang : d.lang,
    theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : d.theme,
    intervalSec: s.intervalSec === 30 || s.intervalSec === 60 || s.intervalSec === 300 ? s.intervalSec : d.intervalSec,
    timeoutMs: num(s.timeoutMs, d.timeoutMs, 2000, 60000),
    prioritySort: typeof s.prioritySort === 'boolean' ? s.prioritySort : d.prioritySort,
    keepAwake: typeof s.keepAwake === 'boolean' ? s.keepAwake : d.keepAwake,
    sslThresholds: Array.isArray(s.sslThresholds)
      ? [...new Set(s.sslThresholds.filter((x) => typeof x === 'number' && x > 0 && x <= 365))].sort((a, b) => b - a)
      : d.sslThresholds,
    suppressEarlyForAuto: typeof s.suppressEarlyForAuto === 'boolean' ? s.suppressEarlyForAuto : d.suppressEarlyForAuto,
    autoRenewUrgentDays: num(s.autoRenewUrgentDays, d.autoRenewUrgentDays, 1, 30),
    sslWarnDays: num(s.sslWarnDays, d.sslWarnDays, 1, 90),
    notify: {
      os: typeof n.os === 'boolean' ? n.os : d.notify.os,
      sound: typeof n.sound === 'boolean' ? n.sound : d.notify.sound,
      telegram: {
        enabled: !!n.telegram?.enabled,
        botToken: String(n.telegram?.botToken ?? ''),
        chatId: String(n.telegram?.chatId ?? ''),
      },
      webhook: { enabled: !!n.webhook?.enabled, url: String(n.webhook?.url ?? '') },
    },
    webProxyUrl: typeof s.webProxyUrl === 'string' ? s.webProxyUrl : '',
  };
}

export const emptyStatus = (): ResourceStatus => ({
  state: 'unknown',
  confirming: false,
  checking: false,
  history: [],
  sslAlertsSent: [],
});

export const HISTORY_LEN = 40;

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
