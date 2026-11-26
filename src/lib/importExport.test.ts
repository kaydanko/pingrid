import { describe, expect, it } from 'vitest';
import { applyImportedSettings, hasDestinations, mergeResources, parseImport, toCsv, toJson } from './importExport';
import { DEFAULT_SETTINGS } from './defaults';
import type { Resource } from '../types';

const r = (over: Partial<Resource> = {}): Resource => ({
  id: 'a',
  name: 'Shop, "main"',
  url: 'https://shop.example.com/',
  checkSsl: true,
  autoRenew: true,
  createdAt: 1,
  ...over,
});

describe('import/export', () => {
  it('round-trips JSON with settings', () => {
    const out = parseImport('x.json', toJson([r()], DEFAULT_SETTINGS));
    expect(out.resources[0]).toMatchObject({ name: 'Shop, "main"', url: 'https://shop.example.com/', autoRenew: true });
    expect(out.settings?.sslThresholds).toEqual(DEFAULT_SETTINGS.sslThresholds);
  });

  it('round-trips CSV with quoting', () => {
    const out = parseImport('x.csv', toCsv([r(), r({ id: 'b', name: 'API', url: 'http://api.local/', checkSsl: false, autoRenew: null })]));
    expect(out.resources).toHaveLength(2);
    expect(out.resources[0].name).toBe('Shop, "main"');
    expect(out.resources[1]).toMatchObject({ checkSsl: false, autoRenew: null });
  });

  it('keeps per-resource intervals and treats blanks as default', () => {
    const out = parseImport('x.csv', toCsv([r({ intervalSec: 300 }), r({ id: 'b', url: 'https://b.example/', intervalSec: null })]));
    expect(out.resources.map((x) => x.intervalSec)).toEqual([300, null]);
    const json = parseImport('x.json', toJson([r({ intervalSec: 30 })], DEFAULT_SETTINGS));
    expect(json.resources[0].intervalSec).toBe(30);
    // Files exported before this column existed still import.
    const old = parseImport('old.csv', 'name,url,checkSsl,autoRenew,paused\nA,https://a.example,true,auto,false');
    expect(old.resources[0].intervalSec).toBeNull();
  });

  it('keeps your alert channels and proxy unless you opt in', () => {
    const mine = { ...DEFAULT_SETTINGS, notify: { ...DEFAULT_SETTINGS.notify, webhook: { enabled: true, url: 'https://hooks.mine.example/x' } } };
    const theirs = {
      ...DEFAULT_SETTINGS,
      intervalSec: 300 as const,
      webProxyUrl: 'http://proxy.theirs.example',
      notify: { ...DEFAULT_SETTINGS.notify, webhook: { enabled: true, url: 'https://collector.theirs.example' } },
    };
    expect(hasDestinations(theirs)).toBe(true);
    const kept = applyImportedSettings(mine, theirs, false);
    expect(kept.intervalSec).toBe(300);
    expect(kept.notify.webhook.url).toBe('https://hooks.mine.example/x');
    expect(kept.webProxyUrl).toBe('');
    expect(applyImportedSettings(mine, theirs, true).notify.webhook.url).toBe('https://collector.theirs.example');
  });

  it('accepts a bare list of domains', () => {
    const out = parseImport('list.csv', 'My site,example.org\nOther,https://other.org/x');
    expect(out.resources.map((x) => x.url)).toEqual(['https://example.org/', 'https://other.org/x']);
  });

  it('merges by URL without duplicates', () => {
    const merged = mergeResources([r()], [r(), r({ id: 'a', url: 'https://new.example/' })]);
    expect(merged).toHaveLength(2);
    expect(new Set(merged.map((x) => x.id)).size).toBe(2);
  });
});
