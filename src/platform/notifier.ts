/**
 * Alert delivery. All channels run client-side: no Pingrid backend exists.
 *  - OS: tauri-plugin-notification (native) / Web Notifications API (PWA)
 *  - Sound: a short WebAudio chime, no audio assets
 *  - Telegram Bot API and generic JSON webhooks
 */
import { invoke, isTauri } from './env';
import { daysWord, formatDate, formatDuration, makeT } from '../i18n';
import type { Alert, Lang, Settings } from '../types';

export type Channel = 'os' | 'sound' | 'telegram' | 'webhook';
export type OsPermission = 'granted' | 'denied' | 'default' | 'unsupported';

const EMOJI: Record<Alert['kind'], string> = {
  down: '🔴',
  up: '🟢',
  'ssl-warning': '🟠',
  'ssl-expired': '⛔',
  'ssl-autorenew-broken': '🚨',
  'ssl-renewed': '🔒',
  test: '📡',
};

export function formatAlert(a: Alert, lang: Lang): { title: string; body: string } {
  const t = makeT(lang);
  const p = {
    name: a.resource.name,
    url: a.resource.url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    error: a.error ?? '',
    d: formatDuration(lang, a.downtimeMs ?? 0),
    days: daysWord(lang, Math.max(0, Math.floor(a.daysLeft ?? a.threshold ?? 0))),
    date: a.sslExpiresAt ? formatDate(lang, a.sslExpiresAt, true) : '',
  };
  switch (a.kind) {
    case 'down':
      return { title: t('alert.down.title', p), body: t('alert.down.body', p).trim() };
    case 'up':
      return { title: t('alert.up.title', p), body: t('alert.up.body', p) };
    case 'ssl-warning':
      return { title: t('alert.sslWarn.title', p), body: t('alert.sslWarn.body', p) };
    case 'ssl-expired':
      return { title: t('alert.sslExpired.title', p), body: t('alert.sslExpired.body', p) };
    case 'ssl-autorenew-broken':
      return { title: t('alert.sslBroken.title', p), body: t('alert.sslBroken.body', p) };
    case 'ssl-renewed':
      return { title: t('alert.sslRenewed.title', p), body: t('alert.sslRenewed.body', p) };
    case 'test':
      return { title: t('alert.test.title'), body: t('alert.test.body') };
  }
}

/* --------------------------------- OS ---------------------------------- */

export async function osPermission(): Promise<OsPermission> {
  if (isTauri) {
    const n = await import('@tauri-apps/plugin-notification');
    return (await n.isPermissionGranted()) ? 'granted' : 'default';
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as OsPermission;
}

export async function requestOsPermission(): Promise<OsPermission> {
  if (isTauri) {
    const n = await import('@tauri-apps/plugin-notification');
    if (await n.isPermissionGranted()) return 'granted';
    return (await n.requestPermission()) as OsPermission;
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  return (await Notification.requestPermission()) as OsPermission;
}

async function sendOs(a: Alert, title: string, body: string) {
  if (isTauri) {
    const n = await import('@tauri-apps/plugin-notification');
    if (!(await n.isPermissionGranted())) throw new Error('permission');
    n.sendNotification({ title: `${EMOJI[a.kind]} ${title}`, body });
    return;
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') throw new Error('permission');
  const opts: NotificationOptions = {
    body,
    icon: '/icon-256.png',
    badge: '/icon-256.png',
    tag: `${a.resource.id}:${a.kind}`,
    requireInteraction: a.severity === 'critical',
  };
  // Android Chrome only allows notifications through a service worker.
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (reg) await reg.showNotification(`${EMOJI[a.kind]} ${title}`, opts);
  else new Notification(`${EMOJI[a.kind]} ${title}`, opts);
}

/* -------------------------------- sound -------------------------------- */

let audio: AudioContext | null = null;

/** Browsers only allow audio after a gesture; call this from any click. */
export function primeAudio() {
  if (audio || typeof AudioContext === 'undefined') return;
  audio = new AudioContext();
}

function chime(kind: Alert['kind']) {
  if (!audio) primeAudio();
  if (!audio) return;
  if (audio.state === 'suspended') void audio.resume();
  // Falling two-tone for trouble, rising for recovery.
  const notes = kind === 'up' || kind === 'ssl-renewed' ? [660, 990] : kind === 'test' ? [880] : [880, 587];
  const t0 = audio.currentTime + 0.02;
  notes.forEach((f, i) => {
    const osc = audio!.createOscillator();
    const g = audio!.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    const s = t0 + i * 0.16;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.18, s + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.32);
    osc.connect(g).connect(audio!.destination);
    osc.start(s);
    osc.stop(s + 0.34);
  });
}

/* ------------------------------- telegram ------------------------------ */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function sendTelegram(cfg: Settings['notify']['telegram'], a: Alert, title: string, body: string) {
  const token = cfg.botToken.trim();
  const chat = cfg.chatId.trim();
  if (!token || !chat) throw new Error('credentials');
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const fields: [string, string][] = [
    ['chat_id', chat],
    ['text', `${EMOJI[a.kind]} <b>${esc(title)}</b>\n${esc(body)}\n<code>${esc(a.resource.url)}</code>`],
    ['parse_mode', 'HTML'],
    ['disable_web_page_preview', 'true'],
  ];
  if (isTauri) {
    await invoke<number>('post_form', { url, fields });
    return;
  }
  // urlencoded body = CORS "simple request": no preflight needed.
  const res = await fetch(url, { method: 'POST', body: new URLSearchParams(fields) });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { description?: string };
    throw new Error(j.description || `HTTP ${res.status}`);
  }
}

/* ------------------------------- webhook ------------------------------- */

export function webhookPayload(a: Alert, title: string, body: string) {
  const line = `${EMOJI[a.kind]} ${title} — ${body}`;
  return {
    // `text` is what Slack renders, `content` is what Discord renders.
    text: line,
    content: line,
    source: 'pingrid',
    event: a.kind,
    severity: a.severity,
    title,
    message: body,
    resource: a.resource,
    at: new Date(a.at).toISOString(),
    ...(a.downtimeMs !== undefined ? { downtimeMs: a.downtimeMs } : {}),
    ...(a.daysLeft !== undefined ? { daysLeft: Math.floor(a.daysLeft) } : {}),
    ...(a.sslExpiresAt ? { sslExpiresAt: new Date(a.sslExpiresAt).toISOString() } : {}),
    ...(a.error ? { error: a.error } : {}),
  };
}

async function sendWebhook(urlRaw: string, a: Alert, title: string, body: string) {
  const url = urlRaw.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('url');
  const payload = webhookPayload(a, title, body);
  if (isTauri) {
    await invoke<number>('post_json', { url, body: payload });
    return;
  }
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    // CORS refused the preflight (Slack does this). A text/plain no-cors POST
    // still reaches the endpoint; we just cannot read the reply.
    await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) });
  }
}

/* ------------------------------- dispatch ------------------------------ */

export interface DeliveryResult {
  channel: Channel;
  ok: boolean;
  error?: string;
}

export async function dispatch(a: Alert, settings: Settings, only?: Channel): Promise<DeliveryResult[]> {
  const { title, body } = formatAlert(a, settings.lang);
  const n = settings.notify;
  const jobs: [Channel, () => Promise<void> | void][] = [];
  const want = (c: Channel, enabled: boolean) => (only ? only === c : enabled);

  if (want('os', n.os)) jobs.push(['os', () => sendOs(a, title, body)]);
  if (want('sound', n.sound)) jobs.push(['sound', () => chime(a.kind)]);
  if (want('telegram', n.telegram.enabled)) jobs.push(['telegram', () => sendTelegram(n.telegram, a, title, body)]);
  if (want('webhook', n.webhook.enabled)) jobs.push(['webhook', () => sendWebhook(n.webhook.url, a, title, body)]);

  const results = await Promise.all(
    jobs.map(async ([channel, run]): Promise<DeliveryResult> => {
      try {
        await run();
        return { channel, ok: true };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        if (!only) console.warn(`[pingrid] ${channel} delivery failed:`, error);
        return { channel, ok: false, error };
      }
    }),
  );
  return results;
}

export function testAlert(): Alert {
  return {
    kind: 'test',
    severity: 'info',
    resource: { id: 'test', name: 'Pingrid', url: 'https://pingrid.local' },
    at: Date.now(),
  };
}
