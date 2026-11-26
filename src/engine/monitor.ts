/**
 * Polling engine.
 *
 *  one timer, armed for the earliest due resource ─► checkOne(id) ─► re-arm
 *     ok   ─► online   (fires "up" if it was offline)
 *     fail ─► confirming, retry in 15s ─► fail again ─► offline, fires "down"
 *
 * SSL certificates are re-read on their own slower schedule (they rarely
 * change), but expiry rules are evaluated on every check and by a timer set
 * for the exact moment of expiry.
 */
import { actions, getState, setState, subscribe } from '../lib/store';
import { HISTORY_LEN } from '../lib/defaults';
import { createChecker, type NetworkChecker, type ProxyStatus } from '../platform/networkChecker';
import { dispatch } from '../platform/notifier';
import { CONFIRM_RETRY_MS, DAY, daysLeft, dueAt, effectiveAutoRenew, evaluateSsl, isDue, isHttps, onFailure } from './rules';
import type { Alert, AlertKind, CheckOutcome, Resource, ResourceStatus, Severity, SslInfo } from '../types';

const SSL_REFRESH_MS = 6 * 3_600_000;
const SSL_REFRESH_NEAR_MS = 30 * 60_000; // inside 7 days: watch for the renewal
const SSL_RETRY_ERROR_MS = 10 * 60_000;
const MAX_CONCURRENCY = 6;
const MAX_TIMEOUT = 2_147_483_647; // setTimeout limit (~24.8 days)

const SEVERITY: Record<AlertKind, Severity> = {
  down: 'critical',
  up: 'info',
  'ssl-warning': 'warning',
  'ssl-expired': 'critical',
  'ssl-autorenew-broken': 'critical',
  'ssl-renewed': 'info',
  test: 'info',
};

/**
 * The scheduler sleeps until the earliest due check instead of polling, so
 * an idle board wakes the CPU only when there is real work. The cap is a
 * safety net against clock jumps and missed wake-ups.
 */
const MAX_SLEEP_MS = 60_000;

class Monitor {
  private checker: NetworkChecker = createChecker('');

  /** Publish proxy health only when it changes, not on every check. */
  private onProxyStatus = (s: ProxyStatus) => {
    const cur = getState().proxyStatus;
    if (cur && cur.ok === s.ok && cur.error === s.error) return;
    setState({ proxyStatus: s });
    // Proxy came back: re-read the certificates that failed while it was down
    // rather than waiting for the 10-minute SSL retry.
    if (cur && !cur.ok && s.ok) setTimeout(() => void this.runAll({ forceSsl: true }), 0);
  };
  private tickTimer?: ReturnType<typeof setTimeout>;
  private planned: { resources?: unknown; settings?: unknown } = {};
  private confirmTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private expiryTimers = new Map<string, { at: number; timer: ReturnType<typeof setTimeout> }>();
  private inflight = new Set<string>();
  /** Checks requested while one was already running; replayed when it ends. */
  private rerun = new Map<string, { forceSsl?: boolean }>();
  private unsub?: () => void;
  private started = false;
  private proxy = '';
  private knownIds = new Set<string>();

  get sslCapable() {
    return this.checker.sslCapable;
  }

  start() {
    if (this.unsub) return;
    this.sync();
    this.unsub = subscribe(() => this.sync());
    // Every resource runs on its own interval (or the global default). New
    // resources have no lastCheck yet, so they are due at once.
    this.tick();
    this.holdWebLock();
    // Catch up at once after the machine wakes or the window comes back.
    document.addEventListener('visibilitychange', this.tick);
    window.addEventListener('online', this.tick);
  }

  stop() {
    this.unsub?.();
    this.unsub = undefined;
    clearTimeout(this.tickTimer);
    this.lockRelease?.();
    this.lockRelease = undefined;
    this.planned = {};
    this.started = false;
    this.knownIds.clear();
    this.confirmTimers.forEach(clearTimeout);
    this.expiryTimers.forEach((e) => clearTimeout(e.timer));
    this.confirmTimers.clear();
    this.expiryTimers.clear();
    document.removeEventListener('visibilitychange', this.tick);
    window.removeEventListener('online', this.tick);
  }

  /**
   * Chromium-based webviews (WebView2 on Windows, Android System WebView)
   * exempt pages holding a Web Lock from intensive background throttling.
   * macOS/iOS are covered by `backgroundThrottling: "disabled"` in
   * tauri.conf.json; this is the documented workaround for the rest.
   */
  private lockRelease?: () => void;
  private holdWebLock() {
    if (this.lockRelease || typeof navigator === 'undefined' || !('locks' in navigator)) return;
    // Only Chromium needs it; WebKit (macOS, iOS, Linux) gains nothing from it.
    if (!/Chrome|Chromium|Edg\//.test(navigator.userAgent)) return;
    void navigator.locks
      .request('pingrid-monitor', () => new Promise<void>((resolve) => (this.lockRelease = resolve)))
      .catch(() => undefined);
  }

  /** Start checks whose time has come (oldest first), then sleep until the next one. */
  private tick = () => {
    const { ready, resources, statuses, settings } = getState();
    if (!ready || !this.started) return;
    const free = MAX_CONCURRENCY - this.inflight.size;
    if (free > 0) {
      const now = Date.now();
      resources
        .filter((r) => !this.inflight.has(r.id) && isDue(r, statuses[r.id], settings, now))
        .sort((x, y) => (statuses[x.id]?.lastCheck ?? 0) - (statuses[y.id]?.lastCheck ?? 0))
        .slice(0, free)
        .forEach((r) => void this.checkOne(r.id));
    }
    this.plan();
  };

  /** Arm one timer for the earliest due check. */
  private plan() {
    clearTimeout(this.tickTimer);
    this.tickTimer = undefined;
    const { ready, resources, statuses, settings } = getState();
    if (!ready || !this.started) return;
    // All slots busy: the next finishing check calls plan() again.
    if (this.inflight.size >= MAX_CONCURRENCY) return;
    let next = Infinity;
    for (const r of resources) {
      if (!this.inflight.has(r.id)) next = Math.min(next, dueAt(r, statuses[r.id], settings));
    }
    if (next === Infinity) return;
    const wait = Math.min(MAX_SLEEP_MS, Math.max(0, next - Date.now()));
    this.tickTimer = setTimeout(this.tick, wait);
  }

  /** React to settings and resource list changes. */
  private sync() {
    const { ready, settings, resources } = getState();
    if (!ready) return;

    const firstRun = !this.started;
    this.started = true;
    if (settings.webProxyUrl !== this.proxy || firstRun) {
      this.proxy = settings.webProxyUrl;
      this.checker = createChecker(this.proxy, this.onProxyStatus);
      setState({ proxyStatus: null });
      // A different way of checking (added, removed or changed proxy): check
      // everything now, certificates included, instead of at the next tick.
      if (!firstRun) void this.runAll({ forceSsl: true });
    }

    // Re-plan only when what the schedule depends on changed; status patches
    // from running checks re-plan when each check finishes.
    if (this.planned.resources !== resources || this.planned.settings !== settings) {
      this.planned = { resources, settings };
      if (!firstRun) this.plan();
    }

    // Removed resources lose their timers.
    const ids = new Set(resources.map((r) => r.id));
    resources.forEach((r) => this.knownIds.add(r.id));
    for (const id of this.knownIds) {
      if (!ids.has(id)) {
        this.knownIds.delete(id);
        clearTimeout(this.confirmTimers.get(id));
        this.confirmTimers.delete(id);
        const e = this.expiryTimers.get(id);
        if (e) clearTimeout(e.timer);
        this.expiryTimers.delete(id);
      }
    }
  }

  /** Check everything now (the "check all" button, proxy switch). */
  async runAll(opts: { forceSsl?: boolean } = {}) {
    const queue = getState().resources.filter((r) => !r.paused).map((r) => r.id);
    const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, async () => {
      while (queue.length) await this.checkOne(queue.shift()!, opts);
    });
    await Promise.all(workers);
  }

  async checkOne(id: string, opts: { retry?: boolean; forceSsl?: boolean } = {}) {
    const r = getState().resources.find((x) => x.id === id);
    if (!r || r.paused) return;
    if (this.inflight.has(id)) {
      // Retries are already covered by the running check; anything else
      // (manual "check now", proxy switch) must not be silently dropped.
      if (!opts.retry) this.rerun.set(id, { forceSsl: !!opts.forceSsl || !!this.rerun.get(id)?.forceSsl });
      return;
    }
    this.inflight.add(id);
    actions.patchStatus(id, { checking: true });

    try {
      const { settings, statuses } = getState();
      const st = statuses[id];
      const wantSsl = this.sslDue(r, st, !!opts.forceSsl);

      const [http, ssl] = await Promise.allSettled([
        this.checker.checkHttp(r.url, settings.timeoutMs),
        wantSsl ? this.checker.inspectTls(r.url, settings.timeoutMs) : Promise.resolve(null),
      ]);

      // The resource may have been edited or removed while we waited.
      const now = getState().resources.find((x) => x.id === id);
      if (!now || now.url !== r.url) return;

      const outcome: CheckOutcome =
        http.status === 'fulfilled'
          ? http.value
          : { ok: false, latencyMs: 0, error: http.reason instanceof Error ? http.reason.message : String(http.reason) };

      if (wantSsl) {
        if (ssl.status === 'fulfilled' && ssl.value) {
          actions.patchStatus(id, { ssl: ssl.value, sslError: undefined, sslCheckedAt: Date.now() });
        } else if (ssl.status === 'rejected') {
          const msg = ssl.reason instanceof Error ? ssl.reason.message : String(ssl.reason);
          actions.patchStatus(id, { sslError: msg, sslCheckedAt: Date.now() });
        }
      }

      this.applyHttp(now, outcome, !!opts.retry);
      this.evaluateSslFor(id);
    } finally {
      this.inflight.delete(id);
      actions.patchStatus(id, { checking: false });
      this.plan();
      const again = this.rerun.get(id);
      if (again) {
        this.rerun.delete(id);
        void this.checkOne(id, again);
      }
    }
  }

  private sslDue(r: Resource, st: ResourceStatus | undefined, force: boolean): boolean {
    if (!r.checkSsl || !isHttps(r.url) || !this.checker.sslCapable) return false;
    if (force || !st?.sslCheckedAt) return true;
    const age = Date.now() - st.sslCheckedAt;
    if (st.sslError) return age > SSL_RETRY_ERROR_MS;
    if (st.ssl && daysLeft(st.ssl, Date.now()) < 7) return age > SSL_REFRESH_NEAR_MS;
    return age > SSL_REFRESH_MS;
  }

  private applyHttp(r: Resource, o: CheckOutcome, isRetry: boolean) {
    const now = Date.now();
    const st = getState().statuses[r.id];
    if (!st) return;
    const history = [...st.history, o.ok ? o.latencyMs : -1].slice(-HISTORY_LEN);

    if (o.ok) {
      this.clearConfirm(r.id);
      if (st.state === 'offline') {
        this.fire(r, 'up', { downtimeMs: st.downSince ? now - st.downSince : undefined });
      }
      actions.patchStatus(r.id, {
        state: 'online',
        confirming: false,
        downSince: undefined,
        latencyMs: o.latencyMs,
        httpStatus: o.status,
        error: undefined,
        lastCheck: now,
        history,
      });
      return;
    }

    const step = onFailure(st, isRetry);
    const base = { httpStatus: o.status, error: o.error, lastCheck: now, history, latencyMs: undefined };
    if (step === 'confirm') {
      actions.patchStatus(r.id, { ...base, confirming: true, downSince: now });
      this.clearConfirm(r.id);
      this.confirmTimers.set(
        r.id,
        setTimeout(() => {
          this.confirmTimers.delete(r.id);
          void this.checkOne(r.id, { retry: true });
        }, CONFIRM_RETRY_MS),
      );
    } else if (step === 'go-offline') {
      this.clearConfirm(r.id);
      const downSince = st.downSince ?? now;
      actions.patchStatus(r.id, { ...base, state: 'offline', confirming: false, downSince });
      this.fire(r, 'down', { error: o.error });
    } else {
      actions.patchStatus(r.id, base);
    }
  }

  private clearConfirm(id: string) {
    const t = this.confirmTimers.get(id);
    if (t) clearTimeout(t);
    this.confirmTimers.delete(id);
  }

  /** Run SSL threshold rules against the stored certificate. */
  evaluateSslFor(id: string) {
    const { resources, statuses, settings } = getState();
    const r = resources.find((x) => x.id === id);
    const st = statuses[id];
    if (!r || !st?.ssl || !r.checkSsl || r.paused) return;
    const ssl = st.ssl;
    const { auto } = effectiveAutoRenew(r, ssl);
    const now = Date.now();
    const d = evaluateSsl({ ssl, auto, sent: st.sslAlertsSent, sentFor: st.sslAlertsFor, settings, now });

    actions.patchStatus(id, { sslAlertsSent: d.sent, sslAlertsFor: d.sentFor });
    for (const f of d.fire) {
      this.fire(r, f.kind, { daysLeft: daysLeft(ssl, now), threshold: f.threshold, sslExpiresAt: ssl.notAfter });
    }
    this.scheduleExpiry(id, ssl);
  }

  /** Fire the "expired" alert at the exact moment the certificate lapses. */
  private scheduleExpiry(id: string, ssl: SslInfo) {
    const existing = this.expiryTimers.get(id);
    if (existing?.at === ssl.notAfter) return;
    if (existing) clearTimeout(existing.timer);
    this.expiryTimers.delete(id);
    const wait = ssl.notAfter - Date.now();
    // Further than ~24 days out: the regular cycle will re-arm it later.
    if (wait <= 0 || wait > Math.min(MAX_TIMEOUT, 24 * DAY)) return;
    const timer = setTimeout(() => {
      this.expiryTimers.delete(id);
      this.evaluateSslFor(id);
    }, wait + 500);
    this.expiryTimers.set(id, { at: ssl.notAfter, timer });
  }

  private fire(r: Resource, kind: AlertKind, extra: Partial<Alert>) {
    const alert: Alert = {
      kind,
      severity: SEVERITY[kind],
      resource: { id: r.id, name: r.name, url: r.url },
      at: Date.now(),
      ...extra,
    };
    void dispatch(alert, getState().settings);
  }

  /** One-off certificate read for the editor's "Detect" button. */
  probeSsl(url: string): Promise<SslInfo> {
    return this.checker.inspectTls(url, getState().settings.timeoutMs);
  }
}

export const monitor = new Monitor();
