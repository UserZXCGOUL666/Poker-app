import { describe, expect, it } from 'vitest';
import { shouldResetSeasonBalances } from './seasons.js';

describe('season activation', () => {
  it('сбрасывает балансы только при переключении на другой сезон', () => {
    expect(shouldResetSeasonBalances(false, true)).toBe(true);
    expect(shouldResetSeasonBalances(true, true)).toBe(false);
    expect(shouldResetSeasonBalances(true, false)).toBe(false);
  });
});
