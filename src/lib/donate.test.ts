import { afterEach, describe, expect, it, vi } from 'vitest';
import { donateTarget } from './donate';

afterEach(() => vi.unstubAllEnvs());

describe('donateTarget', () => {
  it('uses monobank for Ukrainian and Patreon for English', () => {
    vi.stubEnv('VITE_DONATE_MONOBANK_URL', 'https://send.monobank.ua/jar/AbC123xyz');
    vi.stubEnv('VITE_DONATE_PATREON_URL', 'https://www.patreon.com/pingrid');
    expect(donateTarget('uk')).toMatchObject({ provider: 'monobank', url: 'https://send.monobank.ua/jar/AbC123xyz' });
    expect(donateTarget('en')).toMatchObject({ provider: 'patreon', url: 'https://www.patreon.com/pingrid' });
  });

  it('ships with the project links and accepts the /c/<name> Patreon form', () => {
    expect(donateTarget('uk').url).toBe('https://send.monobank.ua/jar/bUjttUaxp');
    expect(donateTarget('en').url).toBe('https://www.patreon.com/c/paulokaydan');
  });

  it('refuses links that are not a monobank jar or a Patreon page', () => {
    vi.stubEnv('VITE_DONATE_MONOBANK_URL', 'https://send.monobank.ua.evil.example/jar/AbC');
    vi.stubEnv('VITE_DONATE_PATREON_URL', 'javascript:alert(1)');
    expect(donateTarget('uk').url).toBe('');
    expect(donateTarget('en').url).toBe('');
  });
});
