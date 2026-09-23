import { describe, expect, it } from 'vitest';
import { AchievementRule } from '@prisma/client';
import { achievementProgressValue, calculateVisitStreak, clubDayKey, dailyIndex, nextClubDayStart } from './loyalty.js';

describe('loyalty rules', () => {
  it('creates a stable club day in the configured timezone', () => {
    const instant = new Date('2026-07-20T21:30:00.000Z');
    expect(clubDayKey(instant, 'Europe/Moscow')).toBe('2026-07-21');
    expect(clubDayKey(instant, 'UTC')).toBe('2026-07-20');
  });

  it('selects the same content for the same day and salt', () => {
    expect(dailyIndex('2026-07-20', 12, 'tip')).toBe(dailyIndex('2026-07-20', 12, 'tip'));
    expect(dailyIndex('2026-07-20', 0, 'tip')).toBe(-1);
  });

  it('finds the next calendar day boundary in the club timezone', () => {
    const instant = new Date('2026-07-24T20:50:00.000Z');
    expect(nextClubDayStart(instant, 'Europe/Moscow').toISOString()).toBe('2026-07-24T21:00:00.000Z');
    expect(nextClubDayStart(instant, 'UTC').toISOString()).toBe('2026-07-25T00:00:00.000Z');
  });

  it('counts current and best visit streaks with reset gaps', () => {
    const dates = ['2026-01-01', '2026-01-08', '2026-01-15', '2026-03-01', '2026-03-08'].map((value) => new Date(`${value}T12:00:00.000Z`));
    expect(calculateVisitStreak(dates, 21)).toEqual({ current: 2, best: 3 });
  });

  it('does not double count two check-ins on the same day', () => {
    const dates = [new Date('2026-01-01T10:00:00.000Z'), new Date('2026-01-01T20:00:00.000Z'), new Date('2026-01-08T12:00:00.000Z')];
    expect(calculateVisitStreak(dates, 21)).toEqual({ current: 2, best: 2 });
  });

  it('maps every achievement rule to the visible player progress', () => {
    const stats = { visits: 8, wins: 2, finalTables: 4, referrals: 3, dailyCorrect: 6, streak: { current: 2, best: 5 } };
    expect(achievementProgressValue(AchievementRule.FIRST_VISIT, stats)).toBe(8);
    expect(achievementProgressValue(AchievementRule.FIRST_WIN, stats)).toBe(2);
    expect(achievementProgressValue(AchievementRule.VISITS, stats)).toBe(8);
    expect(achievementProgressValue(AchievementRule.FINAL_TABLES, stats)).toBe(4);
    expect(achievementProgressValue(AchievementRule.REFERRALS, stats)).toBe(3);
    expect(achievementProgressValue(AchievementRule.STREAK, stats)).toBe(5);
    expect(achievementProgressValue(AchievementRule.DAILY_HAND_CORRECT, stats)).toBe(6);
  });
});
