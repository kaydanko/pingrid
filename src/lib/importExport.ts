import { normalizeSettings } from './defaults';
import { uid } from './defaults';
import { isIntervalSec } from '../engine/rules';
import type { ExportBundle, Resource, Settings } from '../types';

const CSV_COLS = ['name', 'url', 'checkSsl', 'autoRenew', 'paused', 'intervalSec'] as const;

export function toJson(resources: Resource[], settings: Settings): string {
  const bundle: ExportBundle = {
    app: 'pingrid',
    format: 1,
    exportedAt: new Date().toISOString(),
    resources,
    settings,
  };
  return JSON.stringify(bundle, null, 2);
}

const csvCell = (v: string) => (/[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(resources: Resource[]): string {
  const rows = resources.map((r) =>
    [
      r.name,
      r.url,
      String(r.checkSsl),
      r.autoRenew === null ? 'auto-detect' : r.autoRenew ? 'auto' : 'manual',
      String(!!r.paused),
      // Empty = use the global default.
      isIntervalSec(r.intervalSec) ? String(r.intervalSec) : '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [CSV_COLS.join(','), ...rows].join('\r\n') + '\r\n';
}

/** RFC 4180-ish parser: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export function normalizeUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function toResource(raw: Record<string, unknown>): Resource | null {
  const url = normalizeUrl(String(raw.url ?? ''));
  if (!url) return null;
  const ar = raw.autoRenew as unknown;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    name: String(raw.name ?? '').trim() || new URL(url).hostname,
    url,
    checkSsl: raw.checkSsl === undefined ? url.startsWith('https:') : raw.checkSsl === true || raw.checkSsl === 'true',
    autoRenew: ar === true || ar === 'auto' || ar === 'true' ? true : ar === false || ar === 'manual' || ar === 'false' ? false : null,
    paused: raw.paused === true || raw.paused === 'true',
    intervalSec: isIntervalSec(Number(raw.intervalSec)) ? (Number(raw.intervalSec) as Resource['intervalSec']) : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };
}

export interface ImportResult {
  resources: Resource[];
  settings?: Settings;
}

export function parseImport(fileName: string, text: string): ImportResult {
  const trimmed = text.trim().replace(/^﻿/, '');
  if (fileName.toLowerCase().endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const data = JSON.parse(trimmed) as Partial<ExportBundle> | unknown[];
    const list = Array.isArray(data) ? data : (data.resources ?? []);
    const resources = (list as Record<string, unknown>[]).map(toResource).filter((r): r is Resource => !!r);
    const settings = !Array.isArray(data) && data.settings ? normalizeSettings(data.settings) : undefined;
    return { resources, settings };
  }
  const rows = parseCsv(trimmed);
  if (!rows.length) return { resources: [] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const hasHeader = header.includes('url');
  const idx = (k: string, fallback: number) => (hasHeader ? header.indexOf(k.toLowerCase()) : fallback);
  const cols = { name: idx('name', 0), url: idx('url', 1), checkSsl: idx('checkSsl', 2), autoRenew: idx('autoRenew', 3), paused: idx('paused', 4), intervalSec: idx('intervalSec', 5) };
  const body = hasHeader ? rows.slice(1) : rows;
  const resources = body
    .map((r) =>
      toResource({
        name: cols.name >= 0 ? r[cols.name] : undefined,
        url: cols.url >= 0 ? r[cols.url] : undefined,
        checkSsl: cols.checkSsl >= 0 && r[cols.checkSsl] !== undefined && r[cols.checkSsl] !== '' ? r[cols.checkSsl] : undefined,
        autoRenew: cols.autoRenew >= 0 ? r[cols.autoRenew] : undefined,
        paused: cols.paused >= 0 ? r[cols.paused] : undefined,
        intervalSec: cols.intervalSec >= 0 ? r[cols.intervalSec] : undefined,
      } ),
    )
    .filter((r): r is Resource => !!r);
  return { resources };
}

/**
 * Settings from an imported file. Where alerts go (Telegram, webhook, OS/sound
 * switches) and the browser proxy are kept as they are unless the user opts
 * in: a file from someone else must not be able to redirect alerts, which
 * carry resource names and URLs, to its own endpoints.
 */
export function applyImportedSettings(current: Settings, imported: Settings, includeDestinations: boolean): Settings {
  return includeDestinations ? imported : { ...imported, notify: current.notify, webProxyUrl: current.webProxyUrl };
}

/** Does the imported file try to set alert destinations or a proxy? */
export function hasDestinations(s: Settings): boolean {
  return !!(s.notify.telegram.botToken || s.notify.telegram.chatId || s.notify.webhook.url || s.webProxyUrl);
}

/** Merge imported resources into existing ones, de-duplicating by URL. */
export function mergeResources(existing: Resource[], incoming: Resource[]): Resource[] {
  const byUrl = new Map(existing.map((r) => [r.url, r]));
  const ids = new Set(existing.map((r) => r.id));
  const added: Resource[] = [];
  for (const r of incoming) {
    if (byUrl.has(r.url)) continue;
    const copy = ids.has(r.id) ? { ...r, id: uid() } : r;
    byUrl.set(copy.url, copy);
    ids.add(copy.id);
    added.push(copy);
  }
  return [...existing, ...added];
}

/** Save a file: native save dialog is overkill; a download link works in every webview. */
export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
