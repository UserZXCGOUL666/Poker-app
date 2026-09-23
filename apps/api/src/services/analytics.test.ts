import { describe, expect, it } from 'vitest';
import { average, dayKeysBetween, percentage, resolveAnalyticsPeriod, trend, uniqueCount } from './analytics.js';

describe('analytics helpers', () => {
  it('resolves a rolling period and its comparison window', () => {
    const now = new Date('2026-07-21T12:00:00.000Z');
    const range = resolveAnalyticsPeriod('7d', now);
    expect(range.from.toISOString()).toBe('2026-07-14T12:00:00.000Z');
    expect(range.previousFrom.toISOString()).toBe('2026-07-07T12:00:00.000Z');
    expect(range.previousTo.toISOString()).toBe('2026-07-14T12:00:00.000Z');
  });

  it('uses an active season start for the season period', () => {
    const range = resolveAnalyticsPeriod('season', new Date('2026-07-21T12:00:00.000Z'), new Date('2026-06-01T00:00:00.000Z'));
    expect(range.from.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(range.label).toBe('Текущий сезон');
  });

  it('calculates safe rates, averages and trends', () => {
    expect(percentage(7, 8)).toBe(87.5);
    expect(percentage(1, 0)).toBe(0);
    expect(average([2, 3, 5])).toBe(3.3);
    expect(trend(15, 10).deltaPercent).toBe(50);
    expect(trend(4, 0).deltaPercent).toBeNull();
  });

  it('creates inclusive day keys and counts unique values', () => {
    expect(dayKeysBetween(new Date('2026-07-19T08:00:00Z'), new Date('2026-07-21T18:00:00Z'))).toEqual(['2026-07-19', '2026-07-20', '2026-07-21']);
    expect(uniqueCount(['a', 'b', 'a'])).toBe(2);
  });
});
