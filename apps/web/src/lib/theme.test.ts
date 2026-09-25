import { describe, expect, it } from 'vitest';
import { accentRgb, DEFAULT_ACCENT_COLOR, normalizeAccentColor } from './theme';

describe('club accent color', () => {
  it('normalizes valid colors and rejects unsafe CSS values', () => {
    expect(normalizeAccentColor('#ff7a00')).toBe('#FF7A00');
    expect(normalizeAccentColor('red')).toBe(DEFAULT_ACCENT_COLOR);
    expect(normalizeAccentColor('url(javascript:1)')).toBe(DEFAULT_ACCENT_COLOR);
  });

  it('converts the color to an RGB tuple for translucent accents', () => {
    expect(accentRgb('#FF7A00')).toEqual([255, 122, 0]);
  });
});
