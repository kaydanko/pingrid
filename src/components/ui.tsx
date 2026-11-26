import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useT } from '../hooks/useT';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'outline'; size?: 'sm' | 'md' };

export function Button({ variant = 'outline', size = 'md', className, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-ok text-bg hover:brightness-110',
        variant === 'outline' && 'border border-line-strong text-ink hover:bg-raised',
        variant === 'ghost' && 'text-muted hover:text-ink hover:bg-raised',
        variant === 'danger' && 'border border-bad/50 text-bad hover:bg-bad/10',
        className,
      )}
    />
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'grid size-8 shrink-0 place-items-center rounded-md transition-colors',
        active ? 'text-ok bg-ok/10' : 'text-muted hover:text-ink hover:bg-raised',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx('flex cursor-pointer items-start gap-3 py-1.5', disabled && 'cursor-not-allowed opacity-45')}>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="h-5 w-9 rounded-full border border-line-strong bg-bg transition-colors peer-checked:border-ok/60 peer-checked:bg-ok/20 peer-focus-visible:outline-2 peer-focus-visible:outline-info" />
        <span className="absolute top-[3px] left-[3px] size-3.5 rounded-full bg-muted transition-all peer-checked:left-[19px] peer-checked:bg-ok" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-md border border-line-strong p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-8 rounded-[5px] px-3 font-mono text-xs transition-colors',
            o.value === value ? 'bg-raised text-ink shadow-[0_0_0_1px_var(--v-line-strong)]' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block font-mono text-[10.5px] tracking-[0.12em] text-muted uppercase">
      {children}
    </label>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const closeLabel = useT()('common.close');
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => {
      const first = panel.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button');
      first?.focus();
    });
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          'relative flex max-h-[92dvh] w-full animate-rise flex-col border border-line-strong bg-panel shadow-2xl',
          'rounded-t-xl pb-[env(safe-area-inset-bottom)] sm:rounded-xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
      >
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            {title}
          </h2>
          <IconButton label={closeLabel} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
