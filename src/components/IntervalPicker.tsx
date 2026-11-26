import { useEffect, useId, useRef, useState } from 'react';
import { Segmented, cx } from './ui';
import { useLang, useT } from '../hooks/useT';
import { formatInterval } from '../i18n';
import { INTERVAL_PRESETS, MAX_INTERVAL_SEC, MIN_INTERVAL_SEC } from '../engine/rules';

type Unit = 's' | 'm';
type Choice = number | 'custom';

interface Props {
  /** Interval in seconds currently in effect. */
  value: number;
  onChange: (sec: number) => void;
  /** When given, the choice equal to it is marked as the default. */
  defaultValue?: number;
  /** Reports whether the custom field holds a usable value. */
  onValidityChange?: (ok: boolean) => void;
  ariaLabel: string;
}

const unitFor = (sec: number): Unit => (sec >= 60 && sec % 60 === 0 ? 'm' : 's');
const inUnit = (sec: number, unit: Unit) => String(unit === 'm' ? sec / 60 : sec);

/** 30 s · 1 min · 2 min · 5 min · Custom (≥ 10 s), in ascending order. */
export function IntervalPicker({ value, onChange, defaultValue, onValidityChange, ariaLabel }: Props) {
  const t = useT();
  const lang = useLang();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [custom, setCustom] = useState(() => !INTERVAL_PRESETS.includes(value));
  // A value that is already custom keeps its natural unit; otherwise start in
  // seconds, where the 10 s floor reads naturally.
  const [unit, setUnit] = useState<Unit>(() => (INTERVAL_PRESETS.includes(value) ? 's' : unitFor(value)));
  const [draft, setDraft] = useState(() => inUnit(value, INTERVAL_PRESETS.includes(value) ? 's' : unitFor(value)));
  const [error, setError] = useState('');

  useEffect(() => {
    if (custom) input.current?.focus();
  }, [custom]);

  const apply = (text: string, u: Unit) => {
    setDraft(text);
    const n = Number(text.replace(',', '.'));
    const sec = n * (u === 'm' ? 60 : 1);
    let err = '';
    if (!text.trim() || !Number.isFinite(n)) err = t('interval.tooShort');
    else if (!Number.isInteger(sec)) err = t('interval.whole');
    else if (sec < MIN_INTERVAL_SEC) err = t('interval.tooShort');
    else if (sec > MAX_INTERVAL_SEC) err = t('interval.tooLong');
    setError(err);
    onValidityChange?.(!err);
    if (!err) onChange(sec);
  };

  const pick = (c: Choice) => {
    if (c === 'custom') {
      setUnit('s');
      setDraft(String(value));
      setCustom(true);
      return;
    }
    setCustom(false);
    setError('');
    onValidityChange?.(true);
    onChange(c);
  };

  const label = (sec: number) => (
    <span className="inline-flex items-center gap-1">
      {formatInterval(lang, sec)}
      {sec === defaultValue && <span className="size-1.5 rounded-full bg-ok" title={t('interval.defaultMark')} aria-label={t('interval.defaultMark')} />}
    </span>
  );

  return (
    <div>
      <Segmented<Choice>
        ariaLabel={ariaLabel}
        value={custom ? 'custom' : value}
        onChange={pick}
        options={[
          ...INTERVAL_PRESETS.map((sec) => ({ value: sec, label: label(sec) })),
          {
            value: 'custom' as const,
            label: (
              <span className="inline-flex items-center gap-1">
                {t('interval.custom')}
                {custom && value === defaultValue && <span className="size-1.5 rounded-full bg-ok" title={t('interval.defaultMark')} />}
              </span>
            ),
          },
        ]}
      />

      {custom && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor={inputId} className="sr-only">
            {ariaLabel}
          </label>
          <input
            id={inputId}
            ref={input}
            type="number"
            inputMode="decimal"
            min={unit === 'm' ? 1 : MIN_INTERVAL_SEC}
            step={1}
            className={cx('field w-28! font-mono', error && 'border-bad!')}
            value={draft}
            onChange={(e) => apply(e.target.value, unit)}
            aria-invalid={!!error}
          />
          <Segmented<Unit>
            ariaLabel={ariaLabel}
            value={unit}
            onChange={(u) => {
              // Keep the same duration when switching units if it divides evenly.
              const n = Number(draft.replace(',', '.'));
              const sec = n * (unit === 'm' ? 60 : 1);
              const next = Number.isFinite(sec) && sec > 0 ? (u === 'm' ? String(sec / 60) : String(sec)) : draft;
              setUnit(u);
              apply(next, u);
            }}
            options={[
              { value: 's', label: t('interval.unitS') },
              { value: 'm', label: t('interval.unitM') },
            ]}
          />
          {error ? (
            <span className="text-xs text-bad">{error}</span>
          ) : (
            <span className="font-mono text-xs text-muted">= {formatInterval(lang, value)}</span>
          )}
        </div>
      )}
    </div>
  );
}
