import { useState } from 'react';
import { ExternalLink, Heart, Loader2 } from 'lucide-react';
import { Button, Modal } from './ui';
import { toast } from './toast';
import { useLang, useT } from '../hooks/useT';
import { donateTarget } from '../lib/donate';
import { openExternal } from '../platform/env';

/** monobank jar for the Ukrainian interface, Patreon for the English one. */
export function DonatePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const target = donateTarget(lang);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (!target.url) return;
    setBusy(true);
    try {
      await openExternal(target.url);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('donate.title')}>
      <div className="flex flex-col items-center px-2 pt-4 pb-2 text-center">
        <div className="relative mb-6 grid size-20 place-items-center">
          <span className="absolute inset-0 rounded-full border border-bad/30" />
          <span className="absolute inset-[14%] rounded-full border border-bad/20" />
          <Heart className="relative size-8 text-bad" strokeWidth={2.2} fill="currentColor" fillOpacity={0.15} />
        </div>

        <p className="max-w-sm text-[15px] leading-relaxed text-ink">{t('donate.body')}</p>

        <Button variant="primary" className="mt-7 h-11 w-full max-w-xs text-[15px]" onClick={go} disabled={!target.url || busy} data-autofocus>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
          {t('donate.cta')}
        </Button>

        <p className="mt-3 font-mono text-[11px] text-faint">
          {target.url ? t('donate.note', { host: target.host }) : t('donate.missing')}
        </p>
      </div>
    </Modal>
  );
}
