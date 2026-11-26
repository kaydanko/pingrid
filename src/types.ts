export type Lang = 'uk' | 'en';
export type Theme = 'dark' | 'light';
export type IntervalSec = 30 | 60 | 300;

/** A monitored endpoint. Persisted. */
export interface Resource {
  id: string;
  name: string;
  url: string;
  /** Inspect the TLS certificate (https only). */
  checkSsl: boolean;
  /**
   * SSL auto-renewal. `null` = not decided by the user yet; the effective
   * value is then inferred from the certificate issuer.
   */
  autoRenew: boolean | null;
  /** Own check interval; `null`/absent = the global default from Settings. */
  intervalSec?: IntervalSec | null;
  /** Paused resources are shown dimmed and never checked. */
  paused?: boolean;
  createdAt: number;
}

export interface SslInfo {
  notBefore: number;
  notAfter: number;
  issuer: string;
  issuerOrg?: string | null;
  subject: string;
  sans: string[];
  serial?: string;
  chainValid: boolean;
  validationError?: string | null;
  protocol?: string | null;
}

export type LiveState = 'unknown' | 'online' | 'offline';

/** Runtime status of a resource. Persisted (minus history) so downtime survives restarts. */
export interface ResourceStatus {
  state: LiveState;
  /** First check failed; a confirmation retry is scheduled. */
  confirming: boolean;
  checking: boolean;
  latencyMs?: number;
  httpStatus?: number;
  error?: string;
  lastCheck?: number;
  /** Timestamp of the first failed check of the current outage. */
  downSince?: number;
  ssl?: SslInfo;
  sslError?: string;
  sslCheckedAt?: number;
  /** Latency history, newest last. -1 marks a failed check. */
  history: number[];
  /** SSL alert keys already sent for the certificate with `sslAlertsFor` notAfter. */
  sslAlertsSent: string[];
  sslAlertsFor?: number;
}

export interface Settings {
  lang: Lang;
  theme: Theme;
  intervalSec: IntervalSec;
  timeoutMs: number;
  prioritySort: boolean;
  /** Keep the display on while resources are on the board. */
  keepAwake: boolean;
  /** Days before expiry that trigger a warning. */
  sslThresholds: number[];
  /** Hide early (>= autoRenewUrgentDays) warnings for auto-renewing certs. */
  suppressEarlyForAuto: boolean;
  /** Below this many days an auto-renewing cert is considered broken. */
  autoRenewUrgentDays: number;
  /** Tile turns amber at or below this many days (manual certs). */
  sslWarnDays: number;
  notify: {
    os: boolean;
    sound: boolean;
    telegram: { enabled: boolean; botToken: string; chatId: string };
    webhook: { enabled: boolean; url: string };
  };
  /** Web/PWA only: optional CORS/SSL proxy base URL. */
  webProxyUrl: string;
}

export type AlertKind = 'down' | 'up' | 'ssl-warning' | 'ssl-expired' | 'ssl-autorenew-broken' | 'ssl-renewed' | 'test';
export type Severity = 'info' | 'warning' | 'critical';

export interface Alert {
  kind: AlertKind;
  severity: Severity;
  resource: { id: string; name: string; url: string };
  at: number;
  /** Downtime in ms (recovery alerts). */
  downtimeMs?: number;
  /** Days left on the certificate (ssl alerts). */
  daysLeft?: number;
  /** Threshold that fired (ssl-warning). */
  threshold?: number;
  sslExpiresAt?: number;
  error?: string;
}

export interface CheckOutcome {
  ok: boolean;
  status?: number;
  latencyMs: number;
  error?: string;
}

export interface ExportBundle {
  app: 'pingrid';
  format: 1;
  exportedAt: string;
  resources: Resource[];
  settings: Settings;
}
