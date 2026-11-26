import { useEffect, useState } from 'react';
import { cx } from './ui';

type Toast = { id: number; text: string; tone: 'ok' | 'bad' | 'info' };
let seq = 0;
const subs = new Set<(t: Toast) => void>();

export function toast(text: string, tone: Toast['tone'] = 'info') {
  const t = { id: ++seq, text, tone };
  subs.forEach((s) => s(t));
}

export function Toaster() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (t: Toast) => {
      setList((l) => [...l.slice(-3), t]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), 4200);
    };
    subs.add(on);
    return () => void subs.delete(on);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 pb-[env(safe-area-inset-bottom)]">
      {list.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pointer-events-auto max-w-md animate-rise rounded-md border bg-raised px-4 py-2.5 font-mono text-xs shadow-xl',
            t.tone === 'ok' && 'border-ok/50 text-ok',
            t.tone === 'bad' && 'border-bad/50 text-bad',
            t.tone === 'info' && 'border-line-strong text-ink',
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
