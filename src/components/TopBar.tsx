import { useEffect, useState } from 'react';
import { ArrowUpWideNarrow, Eye, EyeOff, Heart, Maximize, Minimize, Moon, Plus, RefreshCw, Settings2, Sun } from 'lucide-react';
import { Button, IconButton, cx } from './ui';
import { useApp, actions } from '../lib/store';
import { useLang, useT } from '../hooks/useT';
import { useNow } from '../hooks/useNow';
import { tileTone } from '../engine/rules';
import { monitor } from '../engine/monitor';
import { formatClock } from '../i18n';
import type { WakeState } from '../hooks/useWakeLock';
import type { Lang } from '../types';

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M3 3h6M3 3v6M29 3h-6M29 3v6M3 29h6M3 29v-6M29 29h-6M29 29v-6" stroke="var(--v-ok)" strokeWidth="2.4" fill="none" />
      <rect x="9" y="9" width="6.2" height="6.2" rx="1" fill="var(--v-ok)" />
      <rect x="16.8" y="9" width="6.2" height="6.2" rx="1" fill="var(--v-ink)" fillOpacity="0.9" />
      <rect x="9" y="16.8" width="6.2" height="6.2" rx="1" fill="var(--v-ink)" fillOpacity="0.55" />
      <rect x="16.8" y="16.8" width="6.2" height="6.2" rx="1" fill="var(--v-ink)" fillOpacity="0.25" />
    </svg>
  );
}

export function TopBar({
  wake,
  onAdd,
  onSettings,
  onDonate,
}: {
  wake: WakeState;
  onAdd: () => void;
  onSettings: () => void;
  onDonate: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const resources = useApp((s) => s.resources);
  const statuses = useApp((s) => s.statuses);
  const settings = useApp((s) => s.settings);
  const now = useNow(60_000);
  const [busy, setBusy] = useState(false);
  const [fs, setFs] = useState(!!document.fullscreenElement);

  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const counts = resources.reduce(
    (acc, r) => {
      const tone = tileTone(r, statuses[r.id], settings, now);
      if (tone === 'online') acc.up++;
      else if (tone === 'offline') acc.down++;
      else if (tone === 'warn' || tone === 'critical') acc.warn++;
      return acc;
    },
    { up: 0, down: 0, warn: 0 },
  );

  const checkAll = async () => {
    setBusy(true);
    await monitor.runAll({ forceSsl: true });
    setBusy(false);
  };

  return (
    <header className="box-content flex h-12 shrink-0 items-center gap-2 px-3 pt-[env(safe-area-inset-top)] sm:gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Logo className="size-6 shrink-0" />
        <span className="hidden font-mono text-[13px] font-semibold tracking-[0.32em] min-[440px]:inline">PINGRID</span>
        <span className="hidden truncate text-xs text-faint lg:inline">/ {t('app.tagline')}</span>
      </div>

      {resources.length > 0 && (
        <div className="ml-1 flex items-center gap-3 font-mono text-[11px] sm:ml-3">
          <Counter n={counts.up} cls="text-ok" label={t('summary.online')} />
          <Counter n={counts.down} cls={counts.down ? 'text-bad' : 'text-faint'} label={t('summary.offline')} pulse={counts.down > 0} />
          {counts.warn > 0 && <Counter n={counts.warn} cls="text-warn" label={t('summary.ssl')} />}
        </div>
      )}

      <div className="ml-auto flex items-center gap-0.5">
        <span className="mr-2 hidden font-mono text-[11px] text-faint tabular-nums md:inline">{formatClock(lang, now)}</span>
        {resources.length > 0 && (
          <>
            <IconButton label={t('nav.checkAll')} onClick={checkAll} disabled={busy}>
              <RefreshCw size={16} className={cx(busy && 'animate-spin')} />
            </IconButton>
            <IconButton
              label={settings.prioritySort ? t('nav.sortOn') : t('nav.sortOff')}
              active={settings.prioritySort}
              onClick={() => actions.setSettings({ prioritySort: !settings.prioritySort })}
            >
              <ArrowUpWideNarrow size={16} />
            </IconButton>
          </>
        )}
        <IconButton
          label={wake === 'active' ? t('nav.wakeOn') : wake === 'unsupported' ? t('nav.wakeUnsupported') : t('nav.wakeOff')}
          active={wake === 'active'}
          aria-pressed={settings.keepAwake}
          className="hidden sm:grid"
          disabled={wake === 'unsupported'}
          onClick={() => actions.setSettings({ keepAwake: !settings.keepAwake })}
        >
          {wake === 'active' ? <Eye size={16} /> : <EyeOff size={16} />}
        </IconButton>
        <LangSwitch lang={lang} label={t('nav.langSwitch')} />
        <IconButton label={t('nav.donate')} className="hidden text-bad/80 hover:text-bad sm:grid" onClick={onDonate}>
          <Heart size={16} />
        </IconButton>
        <IconButton
          label={t('nav.theme')}
          className="hidden sm:grid"
          onClick={() => actions.setSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
        >
          {settings.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>
        {document.fullscreenEnabled && (
          <IconButton
            label={t('nav.fullscreen')}
            className="hidden sm:grid"
            onClick={() => (fs ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)}
          >
            {fs ? <Minimize size={16} /> : <Maximize size={16} />}
          </IconButton>
        )}
        <IconButton label={t('nav.settings')} onClick={onSettings}>
          <Settings2 size={16} />
        </IconButton>
        <Button variant="primary" size="sm" className="ml-1.5 px-2.5 sm:px-3" onClick={onAdd} aria-label={t('nav.add')}>
          <Plus size={16} strokeWidth={2.6} />
          <span className="hidden sm:inline">{t('nav.add')}</span>
        </Button>
      </div>
    </header>
  );
}

/** Always-visible УКР / ENG switch. */
function LangSwitch({ lang, label }: { lang: Lang; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} title={label} className="mx-1 flex shrink-0 rounded-md border border-line-strong p-0.5">
      {(['uk', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={lang === l}
          lang={l}
          onClick={() => actions.setSettings({ lang: l })}
          className={cx(
            'h-6 rounded-[4px] px-1.5 font-mono text-[10.5px] font-semibold tracking-wider transition-colors',
            lang === l ? 'bg-raised text-ink shadow-[0_0_0_1px_var(--v-line-strong)]' : 'text-faint hover:text-ink',
          )}
        >
          {l === 'uk' ? 'УКР' : 'ENG'}
        </button>
      ))}
    </div>
  );
}

function Counter({ n, cls, label, pulse }: { n: number; cls: string; label: string; pulse?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5', cls)} title={`${n} ${label}`}>
      <span className={cx('size-1.5 rounded-full bg-current', pulse && 'blink')} />
      <span className="font-semibold tabular-nums">{n}</span>
      <span className="hidden text-faint sm:inline">{label}</span>
    </span>
  );
}
