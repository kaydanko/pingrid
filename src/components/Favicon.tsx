import { useState } from 'react';

const PALETTE = ['#38e8a8', '#6cb8ff', '#ffb547', '#c792ff', '#ff8f6b', '#5fd4e0'];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Site favicon straight from the origin (no third-party favicon service), monogram fallback. */
export function Favicon({ url, name, className }: { url: string; name: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  let origin = '';
  try {
    origin = new URL(url).origin;
  } catch {
    /* invalid url: monogram */
  }
  const src = origin ? `${origin}/favicon.ico` : '';
  const letter = (name.trim()[0] ?? '?').toUpperCase();
  const color = PALETTE[hash(name || url) % PALETTE.length];

  if (!src || failed === src) {
    return (
      <span
        aria-hidden
        className={`grid shrink-0 place-items-center rounded-[22%] font-mono font-semibold ${className ?? ''}`}
        style={{ color, background: `color-mix(in oklab, ${color} 14%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 35%, transparent)` }}
      >
        {letter}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={`shrink-0 rounded-[22%] bg-white/90 object-contain p-[1.2cqmin] ${className ?? ''}`}
      onError={() => setFailed(src)}
      onLoad={(e) => {
        // Some servers answer /favicon.ico with a 1×1 placeholder.
        if (e.currentTarget.naturalWidth < 8) setFailed(src);
      }}
    />
  );
}
