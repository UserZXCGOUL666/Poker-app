import { describe, expect, it } from 'vitest';
import { addLocalDays, localDateKey, startOfLocalWeek, tournamentVisualState, weekOffsetForDate } from './tournamentWeek';

describe('tournament week helpers', () => {
  it('starts a week on Monday and creates seven stable local day keys', () => {
    const monday = startOfLocalWeek(new Date(2026, 7, 6, 15));
    expect(monday.getDay()).toBe(1);
    expect(localDateKey(monday)).toBe('2026-08-03');
    expect(localDateKey(addLocalDays(monday, 6))).toBe('2026-08-09');
  });

  it('calculates navigation offset relative to the current week', () => {
    const now = new Date(2026, 7, 6, 12);
    expect(weekOffsetForDate(new Date(2026, 7, 20, 12), now)).toBe(2);
    expect(weekOffsetForDate(new Date(2026, 6, 30, 12), now)).toBe(-1);
  });

  it('keeps an active tournament green even when its date is in the past', () => {
    const now = new Date(2026, 7, 6, 12);
    expect(tournamentVisualState('ACTIVE', new Date(2026, 7, 5, 19).toISOString(), now)).toBe('active');
  });

  it('marks an outdated upcoming tournament as finished', () => {
    const now = new Date(2026, 7, 6, 12);
    expect(tournamentVisualState('UPCOMING', new Date(2026, 7, 5, 19).toISOString(), now)).toBe('finished');
    expect(tournamentVisualState('UPCOMING', new Date(2026, 7, 6, 10).toISOString(), now)).toBe('upcoming');
  });

  it('preserves cancellation as a separate state', () => {
    expect(tournamentVisualState('CANCELLED', new Date(2026, 7, 10, 19).toISOString(), new Date(2026, 7, 6, 12))).toBe('cancelled');
  });
});

