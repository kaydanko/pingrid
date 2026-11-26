import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Tauri sets TAURI_ENV_PLATFORM during `tauri dev` / `tauri build`.
const host = process.env.TAURI_DEV_HOST;
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri expects a fixed port; fail if it is taken.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
  },
  build: {
    // WebView2 / WKWebView / Android System WebView are all evergreen.
    target: isTauri ? (process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome110' : 'safari15') : 'es2022',
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 400,
  },
});
