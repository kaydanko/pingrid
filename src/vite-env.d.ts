/// <reference types="vite/client" />
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_DONATE_MONOBANK_URL?: string;
  readonly VITE_DONATE_PATREON_URL?: string;
}
