import { useLayoutEffect, useRef, useState } from 'react';
import { computeGrid, type GridLayout } from '../engine/rules';

export const TILE_MIN_W = 260;
export const TILE_MIN_H = 170;

/** Measures its container and returns an equal-tile grid (or scroll mode). */
export function useGridLayout(count: number, gap: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      setSize((s) => (Math.abs(s.w - w) < 1 && Math.abs(s.h - h) < 1 ? s : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout: GridLayout = computeGrid(count, size.w, size.h, { gap, minW: TILE_MIN_W, minH: TILE_MIN_H });
  return { ref, layout, measured: size.w > 0 };
}
