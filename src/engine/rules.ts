/**
 * Pure decision logic: no I/O, no timers. Everything here is unit-tested.
 */
import type { AlertKind, IntervalSec, Resource, ResourceStatus, Settings, SslInfo } from '../types';

export const DAY = 86_400_000;
export const CONFIRM_RETRY_MS = 15_000;

/**
 * Issuers whose certificates are almost always issued by ACME / managed
 * automation. Matched on the issuer organisation (Let's Encrypt and Google
 * always set O=); short intermediate names like "E6" or "WR2" are not used
 * because commercial CAs reuse them (Sectigo "DV E36").
 */
const AUTO_ISSUER = /let'?s ?encrypt|\bISRG\b|zerossl|google trust services|amazon/i;

export function isAutoIssuer(ssl?: Pick<SslInfo, 'issuer' | 'issuerOrg'> | null): boolean {
  if (!ssl) return false;
  return AUTO_ISSUER.test(`${ssl.issuer ?? ''} ${ssl.issuerOrg ?? ''}`);
}

export function issuerLabel(ssl: Pick<SslInfo, 'issuer' | 'issuerOrg'>): string {
  if (ssl.issuerOrg && ssl.issuerOrg !== ssl.issuer) return `${ssl.issuerOrg} (${ssl.issuer})`;
  return ssl.issuer;
}

/** Effective auto-renew flag: the user's choice, else inferred from the issuer. */
export function effectiveAutoRenew(r: Resource, ssl?: SslInfo): { auto: boolean; inferred: boolean } {
  if (r.autoRenew !== null && r.autoRenew !== undefined) return { auto: r.autoRenew, inferred: false };
  return { auto: isAutoIssuer(ssl), inferred: true };
}

export const isHttps = (url: string) => /^https:\/\//i.test(url);

export const INTERVAL_CHOICES: readonly IntervalSec[] = [30, 60, 300];

export const isIntervalSec = (v: unknown): v is IntervalSec => INTERVAL_CHOICES.includes(v as IntervalSec);

/** The resource's own interval, else the global default. */
export function effectiveInterval(r: Pick<Resource, 'intervalSec'>, settings: Pick<Settings, 'intervalSec'>): IntervalSec {
  return isIntervalSec(r.intervalSec) ? r.intervalSec : settings.intervalSec;
}

/** When the next scheduled check is due (epoch ms). Infinity for paused resources. */
export function dueAt(
  r: Pick<Resource, 'intervalSec' | 'paused'>,
  st: Pick<ResourceStatus, 'lastCheck' | 'confirming'> | undefined,
  settings: Pick<Settings, 'intervalSec'>,
): number {
  if (r.paused) return Infinity;
  if (!st?.lastCheck) return 0;
  // A confirmation retry has its own 15 s timer; this is only the safety net
  // in case that timer was lost (app restart, hot reload).
  if (st.confirming) return st.lastCheck + CONFIRM_RETRY_MS * 2;
  return st.lastCheck + effectiveInterval(r, settings) * 1000;
}

/** Is a scheduled check due now? */
export function isDue(
  r: Pick<Resource, 'intervalSec' | 'paused'>,
  st: Pick<ResourceStatus, 'lastCheck' | 'confirming'> | undefined,
  settings: Pick<Settings, 'intervalSec'>,
  now: number,
): boolean {
  return now >= dueAt(r, st, settings);
}

export function daysLeft(ssl: SslInfo, now: number): number {
  return (ssl.notAfter - now) / DAY;
}

export type SslLevel = 'none' | 'pending' | 'error' | 'ok' | 'warn' | 'expired';

export function sslLevel(r: Resource, st: ResourceStatus | undefined, settings: Settings, now: number): SslLevel {
  if (!r.checkSsl || !isHttps(r.url)) return 'none';
  if (!st?.ssl) return st?.sslError ? 'error' : 'pending';
  const d = daysLeft(st.ssl, now);
  if (d <= 0) return 'expired';
  const { auto } = effectiveAutoRenew(r, st.ssl);
  const warnAt = auto ? settings.autoRenewUrgentDays : settings.sslWarnDays;
  return d <= warnAt ? 'warn' : 'ok';
}

export type Tone = 'online' | 'offline' | 'warn' | 'critical' | 'unknown' | 'paused';

export function tileTone(r: Resource, st: ResourceStatus | undefined, settings: Settings, now: number): Tone {
  if (r.paused) return 'paused';
  if (st?.state === 'offline') return 'offline';
  const ssl = sslLevel(r, st, settings, now);
  if (ssl === 'expired') return 'critical';
  if (ssl === 'warn' || st?.confirming) return 'warn';
  if (st?.state === 'online') return 'online';
  return 'unknown';
}

const TONE_RANK: Record<Tone, number> = { offline: 0, critical: 1, warn: 2, unknown: 3, online: 4, paused: 5 };

/** Stable priority sort: incidents first, original order otherwise. */
export function prioritySort(
  list: Resource[],
  statuses: Record<string, ResourceStatus>,
  settings: Settings,
  now: number,
): Resource[] {
  return list
    .map((r, i) => ({ r, i, rank: TONE_RANK[tileTone(r, statuses[r.id], settings, now)] }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.r);
}

export interface SslDecision {
  fire: { kind: AlertKind; threshold?: number }[];
  sent: string[];
  sentFor: number;
}

/**
 * Decide which SSL alerts to fire for a certificate.
 *  - Each threshold fires at most once per certificate (keyed by notAfter).
 *  - When several thresholds are crossed at once (new resource with 5 days
 *    left), only the tightest one fires.
 *  - Auto-renewing certs skip early warnings and get one urgent alert below
 *    `autoRenewUrgentDays`, since renewal should have happened by then.
 *  - Expiry fires once, at the moment `notAfter` passes.
 *  - A later notAfter on a cert we had warned about fires "renewed".
 */
export function evaluateSsl(args: {
  ssl: SslInfo;
  auto: boolean;
  sent: string[];
  sentFor?: number;
  settings: Pick<Settings, 'sslThresholds' | 'suppressEarlyForAuto' | 'autoRenewUrgentDays'>;
  now: number;
}): SslDecision {
  const { ssl, auto, settings, now } = args;
  const fire: SslDecision['fire'] = [];
  const sameCert = args.sentFor === ssl.notAfter;
  const sent = new Set(sameCert ? args.sent : []);

  if (!sameCert && args.sentFor !== undefined && ssl.notAfter > args.sentFor && args.sent.length > 0) {
    fire.push({ kind: 'ssl-renewed' });
  }

  const left = daysLeft(ssl, now);
  const thresholds = [...new Set(settings.sslThresholds)].filter((t) => t > 0).sort((a, b) => b - a);

  if (left <= 0) {
    if (!sent.has('expired')) fire.push({ kind: 'ssl-expired' });
    sent.add('expired');
    thresholds.forEach((t) => sent.add(`t${t}`));
    sent.add('autorenew-broken');
    return { fire, sent: [...sent], sentFor: ssl.notAfter };
  }

  let active = thresholds;
  let urgentFired = false;
  if (auto) {
    if (left < settings.autoRenewUrgentDays && !sent.has('autorenew-broken')) {
      fire.push({ kind: 'ssl-autorenew-broken' });
      urgentFired = true;
    }
    if (left < settings.autoRenewUrgentDays) sent.add('autorenew-broken');
    if (settings.suppressEarlyForAuto) active = thresholds.filter((t) => t < settings.autoRenewUrgentDays);
  }

  const crossed = active.filter((t) => left <= t && !sent.has(`t${t}`));
  if (crossed.length) {
    const tightest = Math.min(...crossed);
    if (!urgentFired) fire.push({ kind: 'ssl-warning', threshold: tightest });
    crossed.forEach((t) => sent.add(`t${t}`));
  }
  // Suppressed early thresholds count as handled so turning Auto off later
  // does not dump a backlog of stale warnings.
  thresholds.filter((t) => left <= t).forEach((t) => sent.add(`t${t}`));

  return { fire, sent: [...sent], sentFor: ssl.notAfter };
}

export type FailureStep = 'confirm' | 'go-offline' | 'still-offline';

/** Anti-flapping: first failure schedules a retry; a second consecutive failure confirms. */
export function onFailure(st: Pick<ResourceStatus, 'state' | 'confirming'>, isRetry: boolean): FailureStep {
  if (st.state === 'offline') return 'still-offline';
  if (isRetry || st.confirming) return 'go-offline';
  return 'confirm';
}

/** Grid layout: equal tiles that fill the viewport, or a scrolling grid at max readable density. */
export interface GridLayout {
  cols: number;
  rows: number;
  tileW: number;
  tileH: number;
  scroll: boolean;
}

export function computeGrid(
  n: number,
  width: number,
  height: number,
  opts: { gap: number; minW: number; minH: number; targetAspect?: number },
): GridLayout {
  const { gap, minW, minH } = opts;
  const target = opts.targetAspect ?? 1.6;
  if (n <= 0 || width <= 0 || height <= 0) return { cols: 1, rows: 1, tileW: width, tileH: height, scroll: false };

  let best: (GridLayout & { score: number }) | null = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    // Skip layouts whose last row is a whole empty row.
    if ((rows - 1) * cols >= n) continue;
    const tileW = (width - gap * (cols - 1)) / cols;
    const tileH = (height - gap * (rows - 1)) / rows;
    if (tileW < minW || tileH < minH) continue;
    const empty = rows * cols - n;
    // Prefer tiles near the target aspect ratio; penalise empty cells.
    const score = Math.abs(Math.log(tileW / tileH / target)) + empty * 0.35;
    if (!best || score < best.score) best = { cols, rows, tileW, tileH, scroll: false, score };
  }
  if (best) {
    const { score: _score, ...layout } = best;
    void _score;
    return layout;
  }

  // Scroll mode: lock columns to the densest readable count, and size rows
  // so a whole number of them fits the viewport exactly.
  const cols = Math.max(1, Math.min(n, Math.floor((width + gap) / (minW + gap))));
  const tileW = (width - gap * (cols - 1)) / cols;
  const visibleRows = Math.max(1, Math.floor((height + gap) / (minH + gap)));
  const fitH = (height - gap * (visibleRows - 1)) / visibleRows;
  const tileH = Math.max(minH, Math.min(fitH, tileW * 0.9));
  return { cols, rows: Math.ceil(n / cols), tileW, tileH, scroll: true };
}
