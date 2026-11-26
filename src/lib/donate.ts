/**
 * Donation links. The page shows monobank when the interface is Ukrainian and
 * Patreon when it is English.
 *
 * Set them here, or at build time without touching code:
 *   VITE_DONATE_MONOBANK_URL=https://send.monobank.ua/jar/XXXXXXXXXX
 *   VITE_DONATE_PATREON_URL=https://www.patreon.com/<name>
 *
 * Native builds may only open these two hosts (src-tauri/capabilities/default.json).
 */
import type { Lang } from '../types';

const MONOBANK_JAR_URL = 'https://send.monobank.ua/jar/bUjttUaxp';
const PATREON_URL = 'https://www.patreon.com/c/paulokaydan';

export type DonateProvider = 'monobank' | 'patreon';

export interface DonateTarget {
  provider: DonateProvider;
  url: string;
  host: string;
}

const ALLOWED: Record<DonateProvider, RegExp> = {
  monobank: /^https:\/\/send\.monobank\.ua\/jar\/[A-Za-z0-9]+\/?$/,
  patreon: /^https:\/\/(www\.)?patreon\.com\/(c\/)?[A-Za-z0-9_.-]+\/?$/,
};

function pick(provider: DonateProvider, env: string | undefined, fallback: string): DonateTarget {
  const url = (env || fallback).trim();
  // A malformed link is treated as missing rather than opened.
  const ok = ALLOWED[provider].test(url);
  return { provider, url: ok ? url : '', host: provider === 'monobank' ? 'send.monobank.ua' : 'patreon.com' };
}

export function donateTarget(lang: Lang): DonateTarget {
  return lang === 'uk'
    ? pick('monobank', import.meta.env.VITE_DONATE_MONOBANK_URL, MONOBANK_JAR_URL)
    : pick('patreon', import.meta.env.VITE_DONATE_PATREON_URL, PATREON_URL);
}
