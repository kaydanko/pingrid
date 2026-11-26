/**
 * Network abstraction.
 *  - Native: Rust commands (reqwest health check, rustls handshake inspection).
 *  - Web: `fetch` in no-cors mode (reachability + latency only), or a
 *    user-configured proxy that returns full status + certificate data.
 */
import { invoke, isTauri } from './env';
import type { CheckOutcome, SslInfo } from '../types';

export interface NetworkChecker {
  readonly kind: 'native' | 'web' | 'web-proxy';
  /** Can this checker read certificates? */
  readonly sslCapable: boolean;
  checkHttp(url: string, timeoutMs: number): Promise<CheckOutcome>;
  inspectTls(url: string, timeoutMs: number): Promise<SslInfo>;
}

function hostPort(url: string): { host: string; port: number } {
  const u = new URL(url);
  return { host: u.hostname, port: u.port ? Number(u.port) : 443 };
}

class NativeChecker implements NetworkChecker {
  readonly kind = 'native' as const;
  readonly sslCapable = true;

  async checkHttp(url: string, timeoutMs: number): Promise<CheckOutcome> {
    const r = await invoke<{ ok: boolean; status?: number | null; latencyMs: number; error?: string | null }>('check_http', {
      url,
      timeoutMs,
    });
    return { ok: r.ok, status: r.status ?? undefined, latencyMs: r.latencyMs, error: r.error ?? undefined };
  }

  inspectTls(url: string, timeoutMs: number): Promise<SslInfo> {
    const { host, port } = hostPort(url);
    return invoke<SslInfo>('inspect_tls', { host, port, timeoutMs });
  }
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException('timeout', 'TimeoutError')), ms);
  try {
    return await run(ctl.signal);
  } finally {
    clearTimeout(timer);
  }
}

function errText(e: unknown): string {
  if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'timeout';
  return e instanceof Error ? e.message : String(e);
}

/** Browser-only fallback. An opaque no-cors response still proves the host answered. */
class WebChecker implements NetworkChecker {
  readonly kind = 'web' as const;
  readonly sslCapable = false;

  async checkHttp(url: string, timeoutMs: number): Promise<CheckOutcome> {
    const t0 = performance.now();
    try {
      // Cache-buster keeps intermediaries and the SW out of the measurement.
      const u = new URL(url);
      u.searchParams.set('_pingrid', Date.now().toString(36));
      await withTimeout(timeoutMs, (signal) =>
        fetch(u, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', redirect: 'follow', signal }),
      );
      return { ok: true, latencyMs: Math.round(performance.now() - t0) };
    } catch (e) {
      return { ok: false, latencyMs: Math.round(performance.now() - t0), error: errText(e) };
    }
  }

  async inspectTls(): Promise<SslInfo> {
    throw new Error('ssl-unavailable-web');
  }
}

/**
 * Proxy contract (see tools/pingrid-proxy.mjs):
 *   GET {base}/check?url=<url>&timeout=<ms>  -> { ok, status, latencyMs, error? }
 *   GET {base}/tls?host=<host>&port=<port>    -> SslInfo
 */
/** The proxy itself failed (unreachable, refused, blocked by the browser), not the checked site. */
export class ProxyDownError extends Error {}

export interface ProxyStatus {
  ok: boolean;
  error?: string;
  at: number;
}

/** After a proxy failure, go straight to direct checks for this long before trying it again. */
export const PROXY_COOLDOWN_MS = 60_000;

class ProxyChecker implements NetworkChecker {
  readonly kind = 'web-proxy' as const;
  readonly sslCapable = true;
  private direct = new WebChecker();
  private downUntil = 0;
  private lastError = '';

  constructor(
    private base: string,
    private onStatus?: (s: ProxyStatus) => void,
  ) {}

  private report(ok: boolean, error?: string) {
    if (!ok) {
      this.downUntil = Date.now() + PROXY_COOLDOWN_MS;
      this.lastError = error ?? 'unavailable';
    }
    this.onStatus?.({ ok, error, at: Date.now() });
  }

  /**
   * Calls the proxy. Throws ProxyDownError when the proxy is the problem;
   * a plain Error only for a target failure the proxy reported (TLS 502).
   */
  private async get<T>(path: 'check' | 'tls', params: Record<string, string>, timeoutMs: number): Promise<T> {
    if (Date.now() < this.downUntil) throw new ProxyDownError(this.lastError);
    const u = new URL(path, this.base.endsWith('/') ? this.base : this.base + '/');
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    let res: Response;
    try {
      res = await withTimeout(timeoutMs + 3000, (signal) => fetch(u, { cache: 'no-store', signal }));
    } catch (e) {
      // Unreachable, timed out, or blocked by CORS / local-network rules.
      const err = errText(e);
      this.report(false, err);
      throw new ProxyDownError(err);
    }
    const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    // /tls answers 502 when the *target's* handshake fails: the proxy is fine.
    if (path === 'tls' && res.status === 502 && body?.error) {
      this.report(true);
      throw new Error(body.error);
    }
    if (!res.ok || !body) {
      const err = body?.error || `proxy HTTP ${res.status}`;
      this.report(false, err);
      throw new ProxyDownError(err);
    }
    this.report(true);
    return body;
  }

  async checkHttp(url: string, timeoutMs: number): Promise<CheckOutcome> {
    try {
      return await this.get<CheckOutcome>('check', { url, timeout: String(timeoutMs) }, timeoutMs);
    } catch (e) {
      if (!(e instanceof ProxyDownError)) throw e;
      // A broken proxy must not mark every site as down: check directly.
      return this.direct.checkHttp(url, timeoutMs);
    }
  }

  inspectTls(url: string, timeoutMs: number): Promise<SslInfo> {
    const { host, port } = hostPort(url);
    return this.get<SslInfo>('tls', { host, port: String(port) }, timeoutMs);
  }
}

export function createChecker(webProxyUrl: string, onProxyStatus?: (s: ProxyStatus) => void): NetworkChecker {
  if (isTauri) return new NativeChecker();
  const proxy = webProxyUrl.trim();
  if (proxy) {
    try {
      new URL(proxy);
      return new ProxyChecker(proxy, onProxyStatus);
    } catch {
      /* invalid proxy URL: fall through */
    }
  }
  return new WebChecker();
}
