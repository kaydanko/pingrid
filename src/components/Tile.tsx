import { memo } from 'react';
import { Hand, Lock, LockOpen, RefreshCw, RotateCw, ShieldAlert, SquarePen, Timer } from 'lucide-react';
import { Favicon } from './Favicon';
import { cx } from './ui';
import { useNow } from '../hooks/useNow';
import { useLang, useT } from '../hooks/useT';
import { daysLeft, effectiveAutoRenew, isIntervalSec, issuerLabel, sslLevel, tileTone, type SslLevel } from '../engine/rules';
import { formatDate, formatDuration, formatInterval, formatTime } from '../i18n';
import type { Resource, ResourceStatus, Settings } from '../types';

interface Props {
  resource: Resource;
  status?: ResourceStatus;
  settings: Settings;
  sslCapable: boolean;
  index: number;
  onEdit: (id: string) => void;
  onCheck: (id: string) => void;
}

function prettyUrl(url: string) {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.host}${path}${u.search}`;
  } catch {
    return url;
  }
}

function Sparkline({ history, tone }: { history: number[]; tone: string }) {
  if (history.length < 2) return null;
  const max = Math.max(...history.filter((v) => v >= 0), 1);
  const n = 40;
  const pts = history.slice(-n);
  const w = 100 / n;
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="t-spark h-[14%] max-h-12 min-h-3 w-full" aria-hidden>
      {pts.map((v, i) => {
        const x = (n - pts.length + i) * w;
        if (v < 0) return <rect key={i} x={x + w * 0.15} y={0} width={w * 0.7} height={20} fill="var(--v-bad)" opacity={0.55} />;
        const h = Math.max(1.5, (v / max) * 20);
        return <rect key={i} x={x + w * 0.15} y={20 - h} width={w * 0.7} height={h} fill={tone} opacity={0.22 + (i / pts.length) * 0.45} />;
      })}
    </svg>
  );
}

const SSL_COLOR: Record<SslLevel, string> = {
  none: 'text-faint',
  pending: 'text-faint',
  error: 'text-warn',
  ok: 'text-ink',
  warn: 'text-warn',
  expired: 'text-bad',
};

function TileImpl({ resource: r, status: st, settings, sslCapable, index, onEdit, onCheck }: Props) {
  const t = useT();
  const lang = useLang();
  const offline = st?.state === 'offline';
  // Outage counter shows seconds only during the first minute ("45 с"), then
  // minutes, so 1 s ticks are needed only then. Healthy tiles only need the
  // minute clock (SSL day rollover). All tiles share the same aligned clocks.
  const downMs = offline && st?.downSince ? Date.now() - st.downSince : Infinity;
  const now = useNow(downMs < 60_000 ? 1000 : offline ? 15_000 : 60_000);
  const tone = tileTone(r, st, settings, now);
  const level = sslLevel(r, st, settings, now);
  const ssl = st?.ssl;
  const days = ssl ? Math.floor(daysLeft(ssl, now)) : null;
  const renew = effectiveAutoRenew(r, ssl);
  const toneColor = tone === 'online' ? 'var(--v-ok)' : tone === 'warn' ? 'var(--v-warn)' : tone === 'offline' || tone === 'critical' ? 'var(--v-bad)' : 'var(--v-muted)';

  const badge = (() => {
    if (r.paused) return { text: t('tile.paused'), cls: 'text-muted border-line-strong' };
    if (offline) return { text: t('tile.offline'), cls: 'bg-bad text-white border-bad', dot: true };
    if (st?.confirming) return { text: t('tile.confirming'), cls: 'text-warn border-warn/50', dot: true };
    if (st?.state === 'online') return { text: t('tile.online'), cls: 'text-ok border-ok/40' };
    if (st?.checking) return { text: t('tile.checking'), cls: 'text-muted border-line-strong', dot: true };
    return { text: t('tile.unknown'), cls: 'text-faint border-line' };
  })();

  const sslText = (() => {
    if (level === 'none') return t('tile.sslNone');
    if (!sslCapable && !ssl) return t('tile.sslWebOnly');
    if (level === 'pending') return t('tile.sslPending');
    if (level === 'error') return t('tile.sslError');
    if (level === 'expired') return `${t('tile.ssl')} ${t('tile.sslExpired')}`;
    return `${t('tile.ssl')} ${t('tile.sslDays', { n: days ?? 0 })}`;
  })();

  const sslTitle = ssl
    ? [
        t('tile.expiresOn', { date: formatDate(lang, ssl.notAfter, true) }),
        t('tile.issuer', { issuer: issuerLabel(ssl) }),
        !ssl.chainValid && ssl.validationError ? t('tile.chainInvalid', { err: ssl.validationError }) : '',
        renew.inferred ? `${renew.auto ? t('tile.auto') : t('tile.manual')}: ${t('tile.inferred')}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : st?.sslError ?? (!sslCapable && level !== 'none' ? t('editor.hintWeb') : '');

  const SslIcon = level === 'expired' || level === 'error' ? ShieldAlert : level === 'none' ? LockOpen : Lock;

  return (
    <article
      role="button"
      tabIndex={0}
      data-tone={tone}
      data-id={r.id}
      aria-label={`${r.name}: ${badge.text}`}
      onClick={() => onEdit(r.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit(r.id);
        }
      }}
      className="tile group t-pad flex h-full min-h-0 cursor-pointer animate-rise flex-col rounded-[10px] outline-none select-none focus-visible:outline-2 focus-visible:outline-info"
      style={{ animationDelay: `${Math.min(index, 16) * 35}ms` }}
    >
      {tone === 'offline' && <span className="tile-glow" aria-hidden />}

      {/* header */}
      <div className="flex min-w-0 items-start gap-[3.5cqmin]">
        <Favicon url={r.url} name={r.name} className="t-icon t-mono" />
        <div className="min-w-0 flex-1">
          <h3 className="t-name truncate leading-tight font-semibold tracking-tight">{r.name}</h3>
          <p className="t-sub mt-[0.6cqmin] truncate font-mono text-muted">{prettyUrl(r.url)}</p>
        </div>
        <span
          className={cx(
            'inline-flex shrink-0 items-center gap-1.5 rounded-[5px] border px-[1.6cqmin] py-[0.7cqmin] font-mono font-semibold tracking-[0.12em] t-foot',
            badge.cls,
          )}
        >
          {badge.dot && <span className="blink size-[0.55em] rounded-full bg-current" />}
          {badge.text}
        </span>
      </div>

      {/* metric */}
      <div className="flex min-h-0 flex-1 flex-col justify-center py-[2cqmin]">
        {offline ? (
          <>
            <span className="t-foot font-mono tracking-[0.12em] text-bad/80 uppercase">{t('tile.downLabel')}</span>
            <span className="t-metric font-mono font-semibold text-bad tabular-nums">
              {/* "3 год 20 хв": numbers large, units small */}
              {formatDuration(lang, now - (st?.downSince ?? now))
                .split(/(\d+)/)
                .filter(Boolean)
                .map((part, i) =>
                  /^\d+$/.test(part) ? (
                    <span key={i}>{part}</span>
                  ) : (
                    <span key={i} className="t-unit font-normal text-bad/70">
                      {part.trim()}{' '}
                    </span>
                  ),
                )}
            </span>
            {st?.error && <span className="t-foot mt-[1cqmin] truncate font-mono text-muted" title={st.error}>{st.error}</span>}
          </>
        ) : st?.latencyMs !== undefined && !r.paused ? (
          <>
            <span className="flex items-baseline gap-[1.2cqmin]">
              <span className="t-metric font-mono font-semibold tabular-nums" style={{ color: tone === 'warn' ? 'var(--v-warn)' : undefined }}>
                {st.latencyMs}
              </span>
              <span className="t-unit font-mono text-muted">{t('unit.ms')}</span>
            </span>
            {st.confirming && st.error ? (
              <span className="t-foot mt-[1cqmin] truncate font-mono text-warn" title={st.error}>{st.error}</span>
            ) : st.httpStatus ? (
              <span className="t-foot mt-[1cqmin] font-mono text-faint">{t('tile.httpStatus', { s: st.httpStatus })}</span>
            ) : null}
          </>
        ) : (
          <span className="t-metric font-mono text-faint">—</span>
        )}
      </div>

      <Sparkline history={st?.history ?? []} tone={toneColor} />

      {/* footer */}
      <div className="t-foot mt-[2cqmin] flex items-center gap-[2cqmin] border-t border-line pt-[2.2cqmin] font-mono">
        <span className={cx('inline-flex min-w-0 items-center gap-1.5', SSL_COLOR[level])} title={sslTitle}>
          <SslIcon className="size-[1.15em] shrink-0" strokeWidth={2.2} />
          <span className="truncate">{sslText}</span>
        </span>
        {level !== 'none' && (ssl || !renew.inferred) && (
          <span
            className={cx(
              'inline-flex shrink-0 items-center gap-1 rounded-[4px] border px-[1.2cqmin] py-[0.3cqmin]',
              renew.auto ? 'border-info/40 text-info' : 'border-line-strong text-muted',
              renew.inferred && 'border-dashed',
            )}
            title={renew.inferred ? t('tile.inferred') : undefined}
          >
            {renew.auto ? <RefreshCw className="size-[0.95em]" strokeWidth={2.4} /> : <Hand className="size-[0.95em]" strokeWidth={2.4} />}
            {renew.auto ? t('tile.auto') : t('tile.manual')}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {isIntervalSec(r.intervalSec) && (
            <span
              className="inline-flex items-center gap-0.5 text-muted group-hover:hidden group-focus-within:hidden"
              title={t('tile.interval', { v: formatInterval(lang, r.intervalSec) })}
            >
              <Timer className="size-[1em]" strokeWidth={2.2} />
              {formatInterval(lang, r.intervalSec)}
              <span className="mx-0.5 text-faint">·</span>
            </span>
          )}
          {st?.lastCheck && (
            <span className="text-faint group-hover:hidden group-focus-within:hidden" title={t('tile.lastCheck', { t: formatTime(lang, st.lastCheck) })}>
              {formatTime(lang, st.lastCheck).slice(0, 5)}
            </span>
          )}
          <span className="hidden items-center gap-1 group-hover:flex group-focus-within:flex">
            <button
              type="button"
              title={t('tile.checkNow')}
              aria-label={t('tile.checkNow')}
              className="grid size-[1.9em] place-items-center rounded text-muted hover:bg-raised hover:text-ink"
              onClick={(e) => {
                e.stopPropagation();
                onCheck(r.id);
              }}
            >
              <RotateCw className={cx('size-[1.1em]', st?.checking && 'animate-spin')} />
            </button>
            <span className="grid size-[1.9em] place-items-center rounded text-muted" aria-hidden>
              <SquarePen className="size-[1.1em]" />
            </span>
          </span>
        </span>
      </div>
    </article>
  );
}

export const Tile = memo(TileImpl);
