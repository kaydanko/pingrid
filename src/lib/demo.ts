import { makeT } from '../i18n';
import { uid } from './defaults';
import { normalizeUrl } from './importExport';
import type { Lang, Resource } from '../types';

/** Public endpoints that show off every tile state, including failures. */
export function demoResources(lang: Lang): Resource[] {
  const t = makeT(lang);
  const now = Date.now();
  const mk = (name: string, url: string, autoRenew: boolean | null = null, checkSsl = true): Resource => ({
    id: uid(),
    name,
    url: normalizeUrl(url) ?? url,
    checkSsl,
    autoRenew,
    createdAt: now,
  });
  return [
    mk('GitHub', 'https://github.com'),
    mk('Wikipedia', 'https://www.wikipedia.org'),
    mk("Let's Encrypt", 'https://letsencrypt.org'),
    mk('Cloudflare DNS', 'https://1.1.1.1'),
    mk(t('demo.expired'), 'https://expired.badssl.com', false),
    mk(t('demo.offline'), 'https://pingrid-demo.invalid', null),
  ];
}
