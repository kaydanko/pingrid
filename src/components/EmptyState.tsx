import { Plus, Sparkles } from 'lucide-react';
import { Button } from './ui';
import { Logo } from './TopBar';
import { useT } from '../hooks/useT';

export function EmptyState({ onAdd, onDemo }: { onAdd: () => void; onDemo: () => void }) {
  const t = useT();
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="w-full max-w-md animate-rise text-center">
        <div className="relative mx-auto mb-8 grid size-40 place-items-center">
          {/* radar sweep */}
          <div className="absolute inset-0 rounded-full border border-line" />
          <div className="absolute inset-[18%] rounded-full border border-line" />
          <div className="absolute inset-[36%] rounded-full border border-line" />
          <div
            className="absolute inset-0 animate-spin rounded-full [animation-duration:4s]"
            style={{ background: 'conic-gradient(from 0deg, transparent 0 300deg, color-mix(in oklab, var(--v-ok) 28%, transparent) 360deg)' }}
          />
          <Logo className="relative size-14" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('empty.title')}</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted">{t('empty.body')}</p>
        <div className="mt-8 flex flex-col justify-center gap-2 sm:flex-row">
          <Button variant="primary" onClick={onAdd} data-autofocus>
            <Plus size={16} strokeWidth={2.6} />
            {t('empty.add')}
          </Button>
          <Button onClick={onDemo}>
            <Sparkles size={15} />
            {t('empty.demo')}
          </Button>
        </div>
      </div>
    </div>
  );
}
