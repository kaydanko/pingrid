import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { Tile } from './Tile';
import { useGridLayout } from '../hooks/useGridLayout';
import { useNow } from '../hooks/useNow';
import { useApp } from '../lib/store';
import { prioritySort } from '../engine/rules';
import { monitor } from '../engine/monitor';

const GAP = 8;

/**
 * Fills the viewport with equal tiles; once tiles would drop below the
 * readable minimum it locks the column count and scrolls vertically.
 */
export function Dashboard({ onEdit }: { onEdit: (id: string) => void }) {
  const resources = useApp((s) => s.resources);
  const statuses = useApp((s) => s.statuses);
  const settings = useApp((s) => s.settings);
  const now = useNow(60_000);

  const ordered = useMemo(
    () => (settings.prioritySort ? prioritySort(resources, statuses, settings, now) : resources),
    [resources, statuses, settings, now],
  );

  const { ref, layout, measured } = useGridLayout(ordered.length, GAP);
  const onCheck = useCallback((id: string) => void monitor.checkOne(id, { forceSsl: true }), []);
  useFlip(ref, ordered.map((r) => r.id).join('|'));

  return (
    <div
      ref={ref}
      className={`min-h-0 flex-1 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] ${layout.scroll ? 'snap-y snap-proximity overflow-y-auto' : 'overflow-hidden'}`}
    >
      {measured && (
        <div
          className="grid"
          style={{
            gap: GAP,
            gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
            gridAutoRows: `${Math.floor(layout.tileH)}px`,
          }}
        >
          {ordered.map((r, i) => (
            <div key={r.id} data-flip={r.id} className="min-h-0 snap-start">
              <Tile
                resource={r}
                status={statuses[r.id]}
                settings={settings}
                sslCapable={monitor.sslCapable}
                index={i}
                onEdit={onEdit}
                onCheck={onCheck}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** FLIP: tiles glide to their new slot when priority sort reorders them. */
function useFlip(container: React.RefObject<HTMLDivElement | null>, orderKey: string) {
  const rects = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const nodes = el.querySelectorAll<HTMLElement>('[data-flip]');
    const next = new Map<string, DOMRect>();
    nodes.forEach((n) => next.set(n.dataset.flip!, n.getBoundingClientRect()));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      nodes.forEach((n) => {
        const prev = rects.current.get(n.dataset.flip!);
        const cur = next.get(n.dataset.flip!)!;
        if (!prev) return;
        const dx = prev.left - cur.left;
        const dy = prev.top - cur.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
          duration: 520,
          easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
        });
      });
    }
    rects.current = next;
  }, [container, orderKey]);
}
