import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChecker, PROXY_COOLDOWN_MS, type ProxyStatus } from './networkChecker';

const PROXY = 'http://127.0.0.1:8787';
const SITE = 'https://example.com/';

type Handler = (url: URL) => Promise<Response> | Response;
let onProxy: Handler;
let onSite: Handler;
let proxyCalls = 0;
let siteCalls = 0;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  proxyCalls = 0;
  siteCalls = 0;
  onSite = () => new Response(null, { status: 200 });
  vi.stubGlobal('fetch', async (input: URL | string) => {
    const url = new URL(String(input));
    if (url.origin === PROXY) {
      proxyCalls++;
      return onProxy(url);
    }
    siteCalls++;
    return onSite(url);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function make() {
  const statuses: ProxyStatus[] = [];
  const checker = createChecker(PROXY, (s) => statuses.push(s));
  return { checker, statuses };
}

describe('proxy checker', () => {
  it('reports the site as up when the proxy says so', async () => {
    onProxy = () => json(200, { ok: true, status: 200, latencyMs: 42 });
    const { checker, statuses } = make();
    expect(await checker.checkHttp(SITE, 5000)).toMatchObject({ ok: true, status: 200 });
    expect(statuses.at(-1)?.ok).toBe(true);
    expect(siteCalls).toBe(0);
  });

  it('keeps a real site failure reported by a working proxy', async () => {
    onProxy = () => json(200, { ok: false, status: 503, latencyMs: 80, error: 'HTTP 503' });
    const { checker, statuses } = make();
    expect(await checker.checkHttp(SITE, 5000)).toMatchObject({ ok: false, status: 503 });
    expect(statuses.at(-1)?.ok).toBe(true);
    expect(siteCalls).toBe(0);
  });

  it('falls back to a direct check when the proxy is unreachable', async () => {
    onProxy = () => Promise.reject(new TypeError('Failed to fetch'));
    const { checker, statuses } = make();
    const out = await checker.checkHttp(SITE, 5000);
    expect(out.ok).toBe(true); // the site answered directly
    expect(siteCalls).toBe(1);
    expect(statuses.at(-1)).toMatchObject({ ok: false, error: 'Failed to fetch' });
  });

  it('treats a refused proxy (403) as the proxy being down, not the site', async () => {
    onProxy = () => json(403, { error: 'origin not allowed' });
    const { checker, statuses } = make();
    expect((await checker.checkHttp(SITE, 5000)).ok).toBe(true);
    expect(statuses.at(-1)).toMatchObject({ ok: false, error: 'origin not allowed' });
  });

  it('still reports a site that is down when checking directly', async () => {
    onProxy = () => Promise.reject(new TypeError('Failed to fetch'));
    onSite = () => Promise.reject(new TypeError('Failed to fetch'));
    const { checker } = make();
    expect((await checker.checkHttp(SITE, 5000)).ok).toBe(false);
  });

  it('skips a failed proxy for a minute, then tries it again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    onProxy = () => Promise.reject(new TypeError('Failed to fetch'));
    const { checker } = make();
    await checker.checkHttp(SITE, 5000);
    await checker.checkHttp(SITE, 5000);
    await expect(checker.inspectTls(SITE, 5000)).rejects.toThrow('Failed to fetch');
    expect(proxyCalls).toBe(1); // second check and TLS read went straight past it

    vi.setSystemTime(Date.now() + PROXY_COOLDOWN_MS + 1);
    onProxy = () => json(200, { ok: true, status: 200, latencyMs: 30 });
    expect(await checker.checkHttp(SITE, 5000)).toMatchObject({ ok: true, status: 200 });
    expect(proxyCalls).toBe(2);
  });

  it('passes a target TLS failure through without blaming the proxy', async () => {
    onProxy = () => json(502, { error: 'TLS handshake failed: certificate has expired' });
    const { checker, statuses } = make();
    await expect(checker.inspectTls(SITE, 5000)).rejects.toThrow('certificate has expired');
    expect(statuses.at(-1)?.ok).toBe(true);
    // The proxy is fine, so the next call goes to it again.
    onProxy = () => json(200, { ok: true, status: 200, latencyMs: 30 });
    await checker.checkHttp(SITE, 5000);
    expect(proxyCalls).toBe(2);
  });
});
