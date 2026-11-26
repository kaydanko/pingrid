import { describe, expect, it } from 'vitest';
import { computeGrid, CONFIRM_RETRY_MS, DAY, dueAt, effectiveInterval, evaluateSsl, isAutoIssuer, isDue, onFailure } from './rules';
import type { SslInfo } from '../types';

const settings = { sslThresholds: [30, 14, 7, 3, 1], suppressEarlyForAuto: true, autoRenewUrgentDays: 5 };
const now = Date.UTC(2026, 10, 26);
const cert = (days: number, over: Partial<SslInfo> = {}): SslInfo => ({
  notBefore: now - 60 * DAY,
  notAfter: now + days * DAY,
  issuer: 'R11',
  issuerOrg: "Let's Encrypt",
  subject: 'example.com',
  sans: [],
  chainValid: true,
  ...over,
});

describe('evaluateSsl', () => {
  it('fires only the tightest crossed threshold for a fresh cert', () => {
    const d = evaluateSsl({ ssl: cert(5.5), auto: false, sent: [], settings, now });
    expect(d.fire).toEqual([{ kind: 'ssl-warning', threshold: 7 }]);
    expect(d.sent).toEqual(expect.arrayContaining(['t30', 't14', 't7']));
  });

  it('does not repeat a threshold for the same certificate', () => {
    const first = evaluateSsl({ ssl: cert(13), auto: false, sent: [], settings, now });
    const again = evaluateSsl({ ssl: cert(13), auto: false, sent: first.sent, sentFor: first.sentFor, settings, now });
    expect(first.fire).toHaveLength(1);
    expect(again.fire).toHaveLength(0);
  });

  it('suppresses early warnings for auto-renew and alerts urgently below 5d', () => {
    expect(evaluateSsl({ ssl: cert(20), auto: true, sent: [], settings, now }).fire).toEqual([]);
    expect(evaluateSsl({ ssl: cert(6), auto: true, sent: [], settings, now }).fire).toEqual([]);
    const urgent = evaluateSsl({ ssl: cert(4), auto: true, sent: [], settings, now });
    expect(urgent.fire).toEqual([{ kind: 'ssl-autorenew-broken' }]);
    // Same certificate, 1.5 days later.
    const later = evaluateSsl({ ssl: cert(4), auto: true, sent: urgent.sent, sentFor: urgent.sentFor, settings, now: now + 1.5 * DAY });
    expect(later.fire).toEqual([{ kind: 'ssl-warning', threshold: 3 }]);
  });

  it('fires expiry exactly once', () => {
    const exp = evaluateSsl({ ssl: cert(-0.001), auto: false, sent: [], settings, now });
    expect(exp.fire).toEqual([{ kind: 'ssl-expired' }]);
    const again = evaluateSsl({ ssl: cert(-0.001), auto: false, sent: exp.sent, sentFor: exp.sentFor, settings, now });
    expect(again.fire).toEqual([]);
  });

  it('reports renewal and resets thresholds for the new cert', () => {
    const old = evaluateSsl({ ssl: cert(10), auto: false, sent: [], settings, now });
    const renewed = evaluateSsl({ ssl: cert(90), auto: false, sent: old.sent, sentFor: old.sentFor, settings, now });
    expect(renewed.fire).toEqual([{ kind: 'ssl-renewed' }]);
    expect(renewed.sent).toEqual([]);
  });
});

describe('anti-flapping', () => {
  it('needs two consecutive failures', () => {
    expect(onFailure({ state: 'online', confirming: false }, false)).toBe('confirm');
    expect(onFailure({ state: 'online', confirming: true }, false)).toBe('go-offline');
    expect(onFailure({ state: 'online', confirming: true }, true)).toBe('go-offline');
    expect(onFailure({ state: 'offline', confirming: false }, false)).toBe('still-offline');
  });
});

describe('per-resource interval', () => {
  const global = { intervalSec: 60 as const };
  const t0 = Date.UTC(2026, 10, 26, 12);

  it('falls back to the global default', () => {
    expect(effectiveInterval({}, global)).toBe(60);
    expect(effectiveInterval({ intervalSec: null }, global)).toBe(60);
    expect(effectiveInterval({ intervalSec: 300 }, global)).toBe(300);
    // Out of range or fractional values from a hand-edited import are ignored.
    expect(effectiveInterval({ intervalSec: 7 }, global)).toBe(60);
    expect(effectiveInterval({ intervalSec: 9 }, global)).toBe(60);
    expect(effectiveInterval({ intervalSec: 12.5 }, global)).toBe(60);
    expect(effectiveInterval({ intervalSec: 86_401 }, global)).toBe(60);
    // Custom values in range are kept as they are.
    expect(effectiveInterval({ intervalSec: 10 }, global)).toBe(10);
    expect(effectiveInterval({ intervalSec: 90 }, global)).toBe(90);
    expect(effectiveInterval({ intervalSec: 120 }, global)).toBe(120);
  });

  it('schedules each resource on its own interval', () => {
    const st = { lastCheck: t0, confirming: false };
    expect(isDue({ intervalSec: 30 }, st, global, t0 + 29_000)).toBe(false);
    expect(isDue({ intervalSec: 30 }, st, global, t0 + 30_000)).toBe(true);
    expect(isDue({}, st, global, t0 + 30_000)).toBe(false);
    expect(isDue({}, st, global, t0 + 60_000)).toBe(true);
    expect(isDue({ intervalSec: 300 }, st, global, t0 + 120_000)).toBe(false);
  });

  it('reports the exact moment of the next check', () => {
    expect(dueAt({ intervalSec: 30 }, { lastCheck: t0, confirming: false }, global)).toBe(t0 + 30_000);
    expect(dueAt({}, { lastCheck: t0, confirming: false }, global)).toBe(t0 + 60_000);
    expect(dueAt({}, undefined, global)).toBe(0);
    expect(dueAt({ paused: true }, { lastCheck: t0, confirming: false }, global)).toBe(Infinity);
  });

  it('checks new resources at once and never paused ones', () => {
    expect(isDue({}, undefined, global, t0)).toBe(true);
    expect(isDue({}, { lastCheck: undefined, confirming: false }, global, t0)).toBe(true);
    expect(isDue({ paused: true }, undefined, global, t0)).toBe(false);
  });

  it('leaves a pending confirmation to its retry timer', () => {
    const st = { lastCheck: t0, confirming: true };
    expect(isDue({ intervalSec: 30 }, st, global, t0 + CONFIRM_RETRY_MS + 1000)).toBe(false);
    expect(isDue({ intervalSec: 30 }, st, global, t0 + CONFIRM_RETRY_MS * 2)).toBe(true);
  });
});

describe('isAutoIssuer', () => {
  it('recognises ACME issuers', () => {
    expect(isAutoIssuer({ issuer: 'R11', issuerOrg: "Let's Encrypt" })).toBe(true);
    expect(isAutoIssuer({ issuer: 'WR2', issuerOrg: 'Google Trust Services' })).toBe(true);
    expect(isAutoIssuer({ issuer: 'ZeroSSL RSA Domain Secure Site CA', issuerOrg: 'ZeroSSL' })).toBe(true);
    expect(isAutoIssuer({ issuer: 'DigiCert Global G2 TLS RSA SHA256 2020 CA1', issuerOrg: 'DigiCert Inc' })).toBe(false);
    expect(isAutoIssuer({ issuer: 'Sectigo RSA Domain Validation Secure Server CA', issuerOrg: 'Sectigo Limited' })).toBe(false);
    expect(isAutoIssuer({ issuer: 'Sectigo Public Server Authentication CA DV E36', issuerOrg: 'Sectigo Limited' })).toBe(false);
    expect(isAutoIssuer({ issuer: 'YE2', issuerOrg: "Let's Encrypt" })).toBe(true);
  });
});

describe('computeGrid', () => {
  const o = { gap: 8, minW: 260, minH: 170 };
  it('fills the viewport equally when tiles stay readable', () => {
    expect(computeGrid(1, 1600, 900, o)).toMatchObject({ cols: 1, rows: 1, scroll: false });
    expect(computeGrid(4, 1600, 900, o)).toMatchObject({ cols: 2, rows: 2, scroll: false });
    expect(computeGrid(6, 1600, 900, o)).toMatchObject({ cols: 3, rows: 2, scroll: false });
    const two = computeGrid(2, 1600, 900, o);
    expect(two.cols * two.rows).toBe(2);
  });
  it('switches to scroll mode at the readability threshold', () => {
    const g = computeGrid(40, 1600, 900, o);
    expect(g.scroll).toBe(true);
    expect(g.cols).toBe(6);
    expect(g.tileW).toBeGreaterThanOrEqual(260);
    expect(g.tileH).toBeGreaterThanOrEqual(170);
  });
  it('uses one column on a phone in portrait', () => {
    const g = computeGrid(8, 360, 700, o);
    expect(g.cols).toBe(1);
    expect(g.scroll).toBe(true);
  });
});
