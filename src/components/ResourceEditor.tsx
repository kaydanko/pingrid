import { useEffect, useId, useState } from 'react';
import { Loader2, ScanSearch, Trash2 } from 'lucide-react';
import { Button, FieldLabel, Modal, Segmented, Toggle, cx } from './ui';
import { actions, useApp } from '../lib/store';
import { normalizeUrl } from '../lib/importExport';
import { uid } from '../lib/defaults';
import { monitor } from '../engine/monitor';
import { daysLeft, isAutoIssuer, isHttps, isIntervalSec, issuerLabel } from '../engine/rules';
import { IntervalPicker } from './IntervalPicker';
import { useLang, useT } from '../hooks/useT';
import { daysWord, formatDate, formatInterval } from '../i18n';
import type { IntervalSec, Resource, SslInfo } from '../types';

type RenewChoice = 'auto' | 'manual' | 'detect';

export function ResourceEditor({ id, open, onClose }: { id: string | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const existing = useApp((s) => (id ? s.resources.find((r) => r.id === id) : undefined));
  const knownSsl = useApp((s) => (id ? s.statuses[id]?.ssl : undefined));
  const urgentDays = useApp((s) => s.settings.autoRenewUrgentDays);
  const defaultInterval = useApp((s) => s.settings.intervalSec);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [checkSsl, setCheckSsl] = useState(true);
  const [renew, setRenew] = useState<RenewChoice>('detect');
  const [paused, setPaused] = useState(false);
  // null = follow the global default from Settings.
  const [interval, setInterval_] = useState<IntervalSec | null>(null);
  const [intervalOk, setIntervalOk] = useState(true);
  const [touched, setTouched] = useState(false);
  const [probe, setProbe] = useState<{ busy: boolean; ssl?: SslInfo; error?: string }>({ busy: false });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameId = useId();
  const urlId = useId();

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setUrl(existing?.url ?? '');
    setCheckSsl(existing?.checkSsl ?? true);
    setRenew(existing?.autoRenew === true ? 'auto' : existing?.autoRenew === false ? 'manual' : 'detect');
    setPaused(!!existing?.paused);
    setInterval_(isIntervalSec(existing?.intervalSec) ? existing.intervalSec : null);
    setIntervalOk(true);
    setTouched(false);
    setProbe({ busy: false });
    setConfirmDelete(false);
    // Only reset when the dialog opens or switches resource.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id]);

  const normalized = normalizeUrl(url);
  const sameUrl = !!existing && normalized === (normalizeUrl(existing.url) ?? existing.url);
  const https = normalized ? isHttps(normalized) : url.trim().toLowerCase().startsWith('https') || !url.includes('://');
  const ssl = probe.ssl ?? (sameUrl ? knownSsl : undefined);
  const suggestedAuto = ssl ? isAutoIssuer(ssl) : null;

  const runProbe = async () => {
    if (!normalized) return;
    setProbe({ busy: true });
    try {
      const info = await monitor.probeSsl(normalized);
      setProbe({ busy: false, ssl: info });
      if (renew === 'detect') setRenew(isAutoIssuer(info) ? 'auto' : 'manual');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setProbe({ busy: false, error: msg === 'ssl-unavailable-web' ? t('editor.hintWeb') : msg });
    }
  };

  const save = () => {
    setTouched(true);
    if (!normalized || !intervalOk) return;
    const patch: Omit<Resource, 'id' | 'createdAt'> = {
      name: name.trim() || new URL(normalized).hostname,
      url: normalized,
      checkSsl: checkSsl && isHttps(normalized),
      autoRenew: renew === 'detect' ? null : renew === 'auto',
      intervalSec: interval,
      paused,
    };
    if (existing) {
      actions.updateResource(existing.id, patch);
      // Re-read the certificate in case SSL watching or the URL changed.
      setTimeout(() => void monitor.checkOne(existing.id, { forceSsl: true }), 0);
    } else {
      actions.addResources([{ ...patch, id: uid(), createdAt: Date.now() }]);
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? t('editor.editTitle') : t('editor.addTitle')}
      footer={
        <>
          {existing &&
            (confirmDelete ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  actions.removeResource(existing.id);
                  onClose();
                }}
              >
                <Trash2 size={14} />
                {t('editor.deleteConfirm', { name: existing.name })}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="text-bad hover:text-bad" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} />
                {t('editor.delete')}
              </Button>
            ))}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            {t('editor.cancel')}
          </Button>
          <Button variant="primary" onClick={save} disabled={!url.trim() || !intervalOk}>
            {t('editor.save')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div>
          <FieldLabel htmlFor={urlId}>{t('editor.url')}</FieldLabel>
          <input
            id={urlId}
            data-autofocus
            className={cx('field font-mono', touched && !normalized && 'border-bad!')}
            placeholder={t('editor.urlPh')}
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setProbe({ busy: false });
            }}
            onBlur={() => {
              setTouched(true);
              if (!name.trim() && normalized) {
                const host = new URL(normalized).hostname.replace(/^www\./, '');
                setName(host.charAt(0).toUpperCase() + host.slice(1));
              }
              // Read the certificate right away so the Auto/Manual hint is ready.
              if (normalized && isHttps(normalized) && monitor.sslCapable && !probe.ssl && !probe.busy && !sameUrl) {
                void runProbe();
              }
            }}
          />
          {touched && !normalized && url.trim() && <p className="mt-1.5 text-xs text-bad">{t('editor.urlInvalid')}</p>}
        </div>

        <div>
          <FieldLabel htmlFor={nameId}>{t('editor.name')}</FieldLabel>
          <input id={nameId} className="field" placeholder={t('editor.namePh')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="rounded-lg border border-line bg-bg/40 p-4">
          <Toggle
            checked={checkSsl && https}
            disabled={!https}
            onChange={setCheckSsl}
            label={t('editor.checkSsl')}
            hint={!https ? t('editor.checkSslHint') : undefined}
          />

          {checkSsl && https && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-mono text-[10.5px] tracking-[0.12em] text-muted uppercase">{t('editor.autoRenew')}</span>
                <div className="flex items-center gap-2">
                  <Segmented<RenewChoice>
                    value={renew}
                    onChange={setRenew}
                    options={[
                      { value: 'auto', label: t('editor.auto') },
                      { value: 'manual', label: t('editor.manual') },
                    ]}
                  />
                  <Button size="sm" variant="ghost" onClick={runProbe} disabled={!normalized || probe.busy} title={t('editor.detect')}>
                    {probe.busy ? <Loader2 size={14} className="animate-spin" /> : <ScanSearch size={14} />}
                    <span className="hidden sm:inline">{probe.busy ? t('editor.detecting') : t('editor.detect')}</span>
                  </Button>
                </div>
              </div>

              {ssl && (
                <div className="rounded-md border border-line bg-panel p-3 font-mono text-[11.5px] leading-relaxed">
                  <div className="text-ink">{issuerLabel(ssl)}</div>
                  <div className={daysLeft(ssl, Date.now()) <= 0 ? 'text-bad' : 'text-muted'}>
                    {formatDate(lang, ssl.notAfter, true)} · {daysWord(lang, Math.floor(daysLeft(ssl, Date.now())))}
                  </div>
                  {!ssl.chainValid && ssl.validationError && <div className="text-warn">{t('tile.chainInvalid', { err: ssl.validationError })}</div>}
                </div>
              )}
              {probe.error && <p className="text-xs text-warn">{probe.error}</p>}
              {ssl && suggestedAuto !== null && (
                <p className={cx('text-xs leading-relaxed', suggestedAuto ? 'text-info' : 'text-muted')}>
                  {suggestedAuto ? t('editor.hintAuto', { issuer: ssl.issuerOrg || ssl.issuer }) : t('editor.hintManual', { issuer: issuerLabel(ssl) })}
                  {renew === 'detect' && (
                    <button type="button" className="ml-2 underline underline-offset-2" onClick={() => setRenew(suggestedAuto ? 'auto' : 'manual')}>
                      {suggestedAuto ? t('editor.auto') : t('editor.manual')} ✓
                    </button>
                  )}
                </p>
              )}
              {!monitor.sslCapable && !ssl && <p className="text-xs text-muted">{t('editor.hintWeb')}</p>}
              <p className="text-xs leading-relaxed text-faint">{t('editor.autoExplain', { n: urgentDays })}</p>
            </div>
          )}
        </div>

        <div>
          <FieldLabel>{t('editor.interval')}</FieldLabel>
          <IntervalPicker
            ariaLabel={t('editor.interval')}
            value={interval ?? defaultInterval}
            defaultValue={defaultInterval}
            // Choosing the default value means "follow Settings", like before.
            onChange={(sec) => setInterval_(sec === defaultInterval ? null : sec)}
            onValidityChange={setIntervalOk}
          />
          <p className="mt-2 text-xs leading-relaxed text-faint">{t('editor.intervalHint', { v: formatInterval(lang, defaultInterval) })}</p>
        </div>

        {existing && <Toggle checked={paused} onChange={setPaused} label={t('editor.paused')} />}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
