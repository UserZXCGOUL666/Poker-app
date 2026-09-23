import { describe, expect, it } from 'vitest';
import { nextFutureWeeklyStart, nextWeeklyStart } from './recurringTournaments.js';

describe('recurring tournaments', () => {
  it('keeps the exact time while moving one week forward', () => {
    const start = new Date('2026-07-24T17:00:00.000Z');
    expect(nextWeeklyStart(start).toISOString()).toBe('2026-07-31T17:00:00.000Z');
  });

  it('skips missed occurrences instead of creating tournaments in the past', () => {
    const start = new Date('2026-07-03T17:00:00.000Z');
    const now = new Date('2026-07-19T12:00:00.000Z');
    expect(nextFutureWeeklyStart(start, now).toISOString()).toBe('2026-07-24T17:00:00.000Z');
  });
});
