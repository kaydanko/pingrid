#!/usr/bin/env node
/**
 * Pingrid web proxy: optional helper for the browser/PWA build.
 *
 * Browsers cannot read TLS certificates and CORS hides HTTP status codes, so
 * the PWA alone only knows "reachable or not". Run this on any machine you
 * trust and set its URL in Settings → General → CORS / SSL proxy.
 *
 *   node tools/pingrid-proxy.mjs                    # http://127.0.0.1:8787
 *   PORT=9000 HOST=0.0.0.0 PINGRID_ALLOW_ORIGIN=https://pingrid.example.com node tools/pingrid-proxy.mjs
 *
 * Endpoints (GET):
 *   /check?url=<url>&timeout=<ms>  -> { ok, status, latencyMs, error? }
 *   /tls?host=<host>&port=<port>   -> SslInfo (same shape as the Rust command)
 *
 * Zero dependencies, Node 18+.
 */
import http from 'node:http';
import tls from 'node:tls';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
// Only these page origins may read results. "*" allows any site you visit to
// use this proxy to probe hosts reachable from this machine: avoid it.
const ALLOW = (process.env.PINGRID_ALLOW_ORIGIN || 'http://localhost:4173,http://localhost:5173,http://localhost:1420')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function json(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin && (ALLOW.includes('*') || ALLOW.includes(origin))) headers['Access-Control-Allow-Origin'] = ALLOW.includes('*') ? '*' : origin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

async function check(url, timeoutMs) {
  const t0 = performance.now();
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http(s) URLs');
    const res = await fetch(u, {
      redirect: 'follow',
      cache: 'no-store',
      headers: { 'User-Agent': 'Pingrid-proxy/0.1 (uptime monitor)' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Math.round(performance.now() - t0);
    res.body?.cancel().catch(() => {});
    return { ok: res.status < 400, status: res.status, latencyMs, ...(res.status >= 400 ? { error: `HTTP ${res.status}` } : {}) };
  } catch (e) {
    const cause = e?.cause?.code || e?.cause?.message;
    const error = e?.name === 'TimeoutError' ? 'timeout' : [e?.message, cause].filter(Boolean).join(': ');
    return { ok: false, latencyMs: Math.round(performance.now() - t0), error };
  }
}

function inspectTls(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const c = sock.getPeerCertificate(false);
      if (!c || !c.valid_to) {
        sock.destroy();
        return reject(new Error('server sent no certificate'));
      }
      const pick = (v) => (Array.isArray(v) ? v[0] : v);
      const sans = String(c.subjectaltname || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('DNS:'))
        .map((s) => s.slice(4));
      resolve({
        notBefore: Date.parse(c.valid_from),
        notAfter: Date.parse(c.valid_to),
        issuer: pick(c.issuer?.CN) || pick(c.issuer?.O) || 'unknown',
        issuerOrg: pick(c.issuer?.O) || null,
        subject: pick(c.subject?.CN) || '',
        sans: sans.slice(0, 50),
        serial: c.serialNumber,
        chainValid: sock.authorized,
        validationError: sock.authorized ? null : String(sock.authorizationError || 'not trusted'),
        protocol: sock.getProtocol(),
      });
      sock.end();
    });
    sock.on('timeout', () => {
      sock.destroy();
      reject(new Error('TLS handshake timeout'));
    });
    sock.on('error', (e) => reject(new Error(`TLS handshake failed: ${e.message}`)));
  });
}

http
  .createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (req.method === 'OPTIONS') return json(res, 204, {}, origin);
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }, origin);
    const u = new URL(req.url, 'http://proxy');
    const timeout = Math.min(60000, Math.max(1000, Number(u.searchParams.get('timeout')) || 10000));
    try {
      if (u.pathname === '/check') {
        const target = u.searchParams.get('url');
        if (!target) return json(res, 400, { error: 'url required' }, origin);
        return json(res, 200, await check(target, timeout), origin);
      }
      if (u.pathname === '/tls') {
        const host = u.searchParams.get('host');
        const port = Number(u.searchParams.get('port') || 443);
        if (!host) return json(res, 400, { error: 'host required' }, origin);
        return json(res, 200, await inspectTls(host, port, timeout), origin);
      }
      if (u.pathname === '/') return json(res, 200, { app: 'pingrid-proxy', ok: true }, origin);
      return json(res, 404, { error: 'not found' }, origin);
    } catch (e) {
      return json(res, 502, { error: e instanceof Error ? e.message : String(e) }, origin);
    }
  })
  .listen(PORT, HOST, () => {
    console.log(`pingrid-proxy listening on http://${HOST}:${PORT}  (allowed origins: ${ALLOW.join(', ')})`);
  });
