import { useMemo } from 'react';
import { makeT } from '../i18n';
import { useApp } from '../lib/store';

export function useLang() {
  return useApp((s) => s.settings.lang);
}

export function useT() {
  const lang = useLang();
  return useMemo(() => makeT(lang), [lang]);
}
