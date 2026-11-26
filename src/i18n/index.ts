import { en, type TKey } from './en';
import { uk } from './uk';
import type { Lang } from '../types';

export type { TKey };
const dicts = { uk, en } as const;

export type Params = Record<string, string | number>;
export type TFn = (key: TKey, params?: Params) => string;

export function translate(lang: Lang, key: TKey, params?: Params): string {
  const s: string = dicts[lang][key] ?? en[key] ?? key;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}

export const makeT = (lang: Lang): TFn => (key, params) => translate(lang, key, params);

export const locale = (lang: Lang) => (lang === 'uk' ? 'uk-UA' : 'en-GB');

/** Ukrainian day plurals: 1 день, 2 дні, 5 днів. */
export function daysWord(lang: Lang, n: number): string {
  const a = Math.abs(n);
  if (lang === 'en') return `${n} ${a === 1 ? 'day' : 'days'}`;
  const m10 = a % 10;
  const m100 = a % 100;
  if (m10 === 1 && m100 !== 11) return `${n} день`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} дні`;
  return `${n} днів`;
}

/** Compact duration: 45s, 12m, 3h 20m, 2d 4h. */
export function formatDuration(lang: Lang, ms: number): string {
  const t = makeT(lang);
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return t('unit.s', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('unit.m', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${t('unit.h', { n: h })} ${t('unit.m', { n: m % 60 })}` : t('unit.h', { n: h });
  const d = Math.floor(h / 24);
  return h % 24 ? `${t('unit.d', { n: d })} ${t('unit.h', { n: h % 24 })}` : t('unit.d', { n: d });
}

/** 30 → "30 с", 120 → "2 хв", 90 → "1 хв 30 с", 3600 → "1 год". Exact, never rounded. */
export function formatInterval(lang: Lang, sec: number): string {
  const t = makeT(lang);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [h && t('unit.h', { n: h }), m && t('unit.m', { n: m }), s && t('unit.s', { n: s })].filter(Boolean);
  return parts.length ? parts.join(' ') : t('unit.s', { n: 0 });
}

export function formatDate(lang: Lang, ts: number, withTime = false): string {
  return new Intl.DateTimeFormat(locale(lang), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(ts);
}

/** Wall clock without seconds: the board's top bar only needs minutes. */
export function formatClock(lang: Lang, ts: number): string {
  return new Intl.DateTimeFormat(locale(lang), { hour: '2-digit', minute: '2-digit' }).format(ts);
}

export function formatTime(lang: Lang, ts: number): string {
  return new Intl.DateTimeFormat(locale(lang), { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(ts);
}
