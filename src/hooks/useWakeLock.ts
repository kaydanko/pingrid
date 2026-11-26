import { useEffect, useState } from 'react';
import { invoke, isTauri } from '../platform/env';

export type WakeState = 'active' | 'released' | 'unsupported';

const webSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;

/**
 * Keeps the screen on while `enabled`.
 *  - Desktop builds: OS power assertion through the Rust `keep_awake` command
 *    (WKWebView and WebKitGTK lack the Screen Wake Lock API).
 *  - Browser / Android WebView: Screen Wake Lock API, re-acquired after tab switches.
 */
export function useWakeLock(enabled = true): WakeState {
  const [state, setState] = useState<WakeState>(isTauri || webSupported() ? 'released' : 'unsupported');

  useEffect(() => {
    if (!enabled) {
      setState((s) => (s === 'unsupported' ? s : 'released'));
      return;
    }
    let cancelled = false;
    let cleanupWeb: (() => void) | undefined;

    const startWeb = () => {
      if (!webSupported()) {
        setState('unsupported');
        return;
      }
      let sentinel: WakeLockSentinel | null = null;
      const acquire = async () => {
        if (cancelled || document.visibilityState !== 'visible' || sentinel) return;
        try {
          sentinel = await navigator.wakeLock.request('screen');
          if (cancelled) {
            void sentinel.release();
            return;
          }
          setState('active');
          sentinel.addEventListener('release', () => {
            sentinel = null;
            if (!cancelled) setState('released');
          });
        } catch {
          if (!cancelled) setState('released');
        }
      };
      const onVis = () => void acquire();
      void acquire();
      document.addEventListener('visibilitychange', onVis);
      // Some browsers refuse the lock until the first user gesture.
      window.addEventListener('pointerdown', onVis, { once: true });
      cleanupWeb = () => {
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pointerdown', onVis);
        void sentinel?.release();
      };
    };

    if (isTauri) {
      invoke<boolean>('keep_awake', { enable: true })
        .then((held) => {
          if (cancelled) void invoke('keep_awake', { enable: false });
          else setState(held ? 'active' : 'released');
        })
        // Android has no native command: fall back to the WebView API.
        .catch(() => {
          if (!cancelled) startWeb();
        });
    } else {
      startWeb();
    }

    return () => {
      cancelled = true;
      cleanupWeb?.();
      if (isTauri) void invoke('keep_awake', { enable: false }).catch(() => undefined);
    };
  }, [enabled]);

  return state;
}
