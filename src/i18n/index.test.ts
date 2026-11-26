import { describe, expect, it } from 'vitest';
import { formatInterval } from './index';

describe('formatInterval', () => {
  it('is exact for presets and custom values', () => {
    expect(formatInterval('uk', 10)).toBe('10 с');
    expect(formatInterval('uk', 120)).toBe('2 хв');
    expect(formatInterval('uk', 90)).toBe('1 хв 30 с');
    expect(formatInterval('en', 3600)).toBe('1h');
    expect(formatInterval('en', 5430)).toBe('1h 30m 30s');
  });
});
