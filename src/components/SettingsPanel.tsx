import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, Heart, Loader2, Send, Sparkles, Trash2, Upload } from 'lucide-react';
import { Button, FieldLabel, Modal, Segmented, Toggle, cx } from './ui';
import { toast } from './toast';
import { actions, useApp } from '../lib/store';
import { demoResources } from '../lib/demo';
import { applyImportedSettings, download, hasDestinations, mergeResources, parseImport, toCsv, toJson } from '../lib/importExport';
import { dispatch, osPermission, requestOsPermission, testAlert, type Channel, type OsPermission } from '../platform/notifier';
import { isTauri, platformLabel } from '../platform/env';
import { useT } from '../hooks/useT';
import type { IntervalSec, Settings } from '../types';

type Tab = 'general' | 'alerts' | 'data';
const THRESHOLD_CHOICES = [60, 30, 21, 14, 7, 5, 3, 2, 1];

function Section({ title, children, aside }: { title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-b border-line py-4 first:pt-0 last:border-b-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-mono text-[10.5px] tracking-[0.14em] text-muted uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function SettingsPanel({ open, onClose, onDonate }: { open: boolean; onClose: () => void; onDonate: () => void }) {
  const t = useT();
  const settings = useApp((s) => s.settings);
  const resources = useApp((s) => s.resources);
  const storageKind = useApp((s) => s.storageKind);
  const [tab, setTab] = useState<Tab>('general');
  const [perm, setPerm] = useState<OsPermission>('default');
  const [testing, setTesting] = useState<Channel | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importDest, setImportDest] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setConfirmClear(false);
    osPermission().then(setPerm).catch(() => setPerm('unsupported'));
  }, [open]);

  const set = (patch: Partial<Settings>) => actions.setSettings(patch);
  const setNotify = (patch: Partial<Settings['notify']>) => actions.setSettings((s) => ({ ...s, notify: { ...s.notify, ...patch } }));

  const test = async (channel: Channel) => {
    setTesting(channel);
    if (channel === 'os' && perm !== 'granted') setPerm(await requestOsPermission());
    const [res] = await dispatch(testAlert(), settings, channel);
    setTesting(null);
    const name = t(`channel.${channel}` as const);
    if (res?.ok) toast(`${t('settings.testOk')} · ${name}`, 'ok');
    else {
      // Our own error codes are translated; anything else is the server's text.
      const err = res?.error ?? 'failed';
      const known = ['permission', 'credentials', 'url', 'failed'].includes(err);
      toast(`${name}: ${known ? t(`err.${err as 'permission' | 'credentials' | 'url' | 'failed'}`) : err}`, 'bad');
    }
  };

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const { resources: incoming, settings: imported } = parseImport(file.name, text);
      if (importMode === 'replace') actions.replaceResources(incoming);
      else actions.addResources(mergeResources(resources, incoming).slice(resources.length));
      const keptDest = !!imported && !importDest && hasDestinations(imported);
      if (imported) actions.setSettings((cur) => applyImportedSettings(cur, imported, importDest));
      toast(t('settings.importDone', { n: incoming.length }) + (keptDest ? ` · ${t('settings.importKeptDest')}` : ''), 'ok');
      setImportDest(false);
    } catch (e) {
      toast(t('settings.importFail', { err: e instanceof Error ? e.message : String(e) }), 'bad');
    }
  };

  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <Modal open={open} onClose={onClose} title={t('settings.title')} wide>
      <div role="tablist" className="-mt-1 mb-4 flex gap-1 border-b border-line">
        {(['general', 'alerts', 'data'] as Tab[]).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              tab === k ? 'border-ok text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t(`settings.tab.${k}` as const)}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div>
          <Section title={t('settings.interval')}>
            <Segmented<IntervalSec>
              value={settings.intervalSec}
              onChange={(v) => set({ intervalSec: v })}
              options={[
                { value: 30, label: t('unit.s', { n: 30 }) },
                { value: 60, label: t('unit.m', { n: 1 }) },
                { value: 300, label: t('unit.m', { n: 5 }) },
              ]}
            />
            <p className="mt-2 text-xs leading-relaxed text-muted">{t('settings.intervalHint')}</p>
          </Section>
          <Section title={t('settings.timeout')}>
            <Segmented<number>
              value={settings.timeoutMs}
              onChange={(v) => set({ timeoutMs: v })}
              options={[5000, 10000, 20000, 30000].map((v) => ({ value: v, label: t('unit.s', { n: v / 1000 }) }))}
            />
          </Section>
          <Section title={`${t('settings.language')} · ${t('settings.theme')}`}>
            <div className="flex flex-wrap gap-3">
              <Segmented
                value={settings.lang}
                onChange={(v) => set({ lang: v })}
                options={[
                  { value: 'uk', label: 'Українська' },
                  { value: 'en', label: 'English' },
                ]}
              />
              <Segmented
                value={settings.theme}
                onChange={(v) => set({ theme: v })}
                options={[
                  { value: 'dark', label: t('settings.theme.dark') },
                  { value: 'light', label: t('settings.theme.light') },
                ]}
              />
            </div>
          </Section>
          <Section title={t('settings.sslWarnDays')}>
            <div className="flex flex-wrap items-center gap-4">
              <Segmented<number>
                value={settings.sslWarnDays}
                onChange={(v) => set({ sslWarnDays: v })}
                options={[30, 21, 14, 7].map((v) => ({ value: v, label: t('unit.d', { n: v }) }))}
              />
            </div>
            <div className="mt-3">
              <Toggle checked={settings.prioritySort} onChange={(v) => set({ prioritySort: v })} label={t('settings.prioritySort')} />
              <Toggle checked={settings.keepAwake} onChange={(v) => set({ keepAwake: v })} label={t('settings.keepAwake')} hint={t('settings.keepAwakeHint')} />
            </div>
          </Section>
          {!isTauri && (
            <Section title={t('settings.web')}>
              <FieldLabel>{t('settings.webProxy')}</FieldLabel>
              {/* Committed on blur/Enter: a half-typed proxy URL must never become the live checker. */}
              <input
                key={settings.webProxyUrl}
                className="field font-mono"
                placeholder="http://localhost:8787"
                defaultValue={settings.webProxyUrl}
                onBlur={(e) => e.target.value.trim() !== settings.webProxyUrl && set({ webProxyUrl: e.target.value.trim() })}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                spellCheck={false}
              />
              <p className="mt-2 text-xs leading-relaxed text-muted">{t('settings.webProxyHint')}</p>
            </Section>
          )}
          <div className="pt-1 pb-3">
            <Button size="sm" variant="ghost" className="-ml-3 text-bad hover:text-bad" onClick={onDonate}>
              <Heart size={14} />
              {t('settings.donate')}
            </Button>
          </div>
          <p className="pt-2 font-mono text-[10.5px] text-faint">
            {t('settings.version', { v: __APP_VERSION__, platform: platformLabel() })} · {t('settings.storage', { kind: storageKind ?? '—' })}
          </p>
        </div>
      )}

      {tab === 'alerts' && (
        <div>
          <Section
            title={t('settings.os')}
            aside={<TestButton busy={testing === 'os'} onClick={() => test('os')} label={t('settings.test')} />}
          >
            <Toggle
              checked={settings.notify.os}
              onChange={async (v) => {
                setNotify({ os: v });
                if (v && perm !== 'granted') setPerm(await requestOsPermission());
              }}
              label={t('settings.os')}
              hint={perm === 'denied' ? t('settings.osDenied') : undefined}
            />
            <Toggle checked={settings.notify.sound} onChange={(v) => setNotify({ sound: v })} label={t('settings.sound')} />
          </Section>

          <Section
            title={t('settings.telegram')}
            aside={<TestButton busy={testing === 'telegram'} onClick={() => test('telegram')} label={t('settings.test')} disabled={!settings.notify.telegram.botToken || !settings.notify.telegram.chatId} />}
          >
            <Toggle
              checked={settings.notify.telegram.enabled}
              onChange={(v) => setNotify({ telegram: { ...settings.notify.telegram, enabled: v } })}
              label={t('settings.telegram')}
              hint={t('settings.telegramHint')}
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr]">
              <div>
                <FieldLabel>{t('settings.botToken')}</FieldLabel>
                <input
                  className="field font-mono"
                  type="password"
                  autoComplete="off"
                  placeholder="123456:ABC-DEF…"
                  value={settings.notify.telegram.botToken}
                  onChange={(e) => setNotify({ telegram: { ...settings.notify.telegram, botToken: e.target.value } })}
                />
              </div>
              <div>
                <FieldLabel>{t('settings.chatId')}</FieldLabel>
                <input
                  className="field font-mono"
                  placeholder="-100123456789"
                  value={settings.notify.telegram.chatId}
                  onChange={(e) => setNotify({ telegram: { ...settings.notify.telegram, chatId: e.target.value } })}
                />
              </div>
            </div>
          </Section>

          <Section
            title={t('settings.webhook')}
            aside={<TestButton busy={testing === 'webhook'} onClick={() => test('webhook')} label={t('settings.test')} disabled={!settings.notify.webhook.url} />}
          >
            <Toggle
              checked={settings.notify.webhook.enabled}
              onChange={(v) => setNotify({ webhook: { ...settings.notify.webhook, enabled: v } })}
              label={t('settings.webhook')}
              hint={t('settings.webhookHint')}
            />
            <div className="mt-3">
              <FieldLabel>{t('settings.webhookUrl')}</FieldLabel>
              <input
                className="field font-mono"
                placeholder="https://hooks.slack.com/services/…"
                value={settings.notify.webhook.url}
                spellCheck={false}
                onChange={(e) => setNotify({ webhook: { ...settings.notify.webhook, url: e.target.value } })}
              />
            </div>
          </Section>

          <Section title={t('settings.thresholds')}>
            <div className="flex flex-wrap gap-1.5">
              {THRESHOLD_CHOICES.map((d) => {
                const on = settings.sslThresholds.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      set({
                        sslThresholds: on ? settings.sslThresholds.filter((x) => x !== d) : [...settings.sslThresholds, d].sort((a, b) => b - a),
                      })
                    }
                    className={cx(
                      'h-8 min-w-11 rounded-md border px-2.5 font-mono text-xs transition-colors',
                      on ? 'border-warn/60 bg-warn/10 text-warn' : 'border-line-strong text-muted hover:text-ink',
                    )}
                  >
                    {t('unit.d', { n: d })}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 space-y-1">
              <Toggle
                checked={settings.suppressEarlyForAuto}
                onChange={(v) => set({ suppressEarlyForAuto: v })}
                label={t('settings.suppressAuto', { n: settings.autoRenewUrgentDays })}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <span className="text-sm">{t('settings.urgentDays')}</span>
                <Segmented<number>
                  value={settings.autoRenewUrgentDays}
                  onChange={(v) => set({ autoRenewUrgentDays: v })}
                  options={[3, 5, 7, 10].map((v) => ({ value: v, label: t('unit.d', { n: v }) }))}
                />
              </div>
            </div>
          </Section>
        </div>
      )}

      {tab === 'data' && (
        <div>
          <Section title={t('settings.export')}>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => download(`pingrid-${stamp}.json`, toJson(resources, settings), 'application/json')}>
                <Download size={14} />
                {t('settings.exportJson')}
              </Button>
              <Button size="sm" onClick={() => download(`pingrid-${stamp}.csv`, toCsv(resources), 'text/csv;charset=utf-8')}>
                <Download size={14} />
                {t('settings.exportCsv')}
              </Button>
            </div>
            {(settings.notify.telegram.botToken || settings.notify.webhook.url) && (
              <p className="mt-2 text-xs text-warn">{t('settings.exportWarn')}</p>
            )}
          </Section>
          <Section title={t('settings.import')}>
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                ariaLabel={t('settings.importMode')}
                value={importMode}
                onChange={setImportMode}
                options={[
                  { value: 'merge', label: t('settings.importMerge') },
                  { value: 'replace', label: t('settings.importReplace') },
                ]}
              />
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                <Upload size={14} />
                {t('settings.import')}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.csv,application/json,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onImport(f);
                  e.target.value = '';
                }}
              />
            </div>
            <div className="mt-3">
              <Toggle checked={importDest} onChange={setImportDest} label={t('settings.importDest')} hint={t('settings.importDestHint')} />
            </div>
          </Section>
          <Section title={t('settings.demo')}>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => actions.addResources(mergeResources(resources, demoResources(settings.lang)).slice(resources.length))}>
                <Sparkles size={14} />
                {t('settings.demo')}
              </Button>
              {confirmClear ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    await actions.clearAll();
                    setConfirmClear(false);
                    onClose();
                  }}
                >
                  <Trash2 size={14} />
                  {t('settings.clearConfirm')}
                </Button>
              ) : (
                <Button size="sm" variant="danger" onClick={() => setConfirmClear(true)}>
                  <Trash2 size={14} />
                  {t('settings.clear')}
                </Button>
              )}
            </div>
          </Section>
        </div>
      )}
    </Modal>
  );
}

function TestButton({ busy, onClick, label, disabled }: { busy: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} disabled={busy || disabled}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
      {label}
    </Button>
  );
}
