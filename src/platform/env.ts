/** True when running inside a Tauri v2 webview (desktop or Android). */
export const isTauri: boolean =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const platformLabel = (): 'native' | 'web' => (isTauri ? 'native' : 'web');

/** Lazily import @tauri-apps/api/core so the PWA bundle never loads it. */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

/** Open a URL in the system browser (native) or a new tab (web). */
export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
