import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { hydrate } from './lib/store';
import { isTauri } from './platform/env';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

hydrate().catch((e) => {
  console.error('[pingrid] failed to load local data', e);
});

// PWA only: Tauri serves assets from the app bundle already.
if (!isTauri && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[pingrid] SW registration failed', e));
  });
}
