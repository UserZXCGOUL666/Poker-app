import { describe, expect, it } from 'vitest';
import { TournamentTimerStatus } from '@prisma/client';
import { resolveTimerClock } from './tournamentTimer.js';

const levels = [{ durationSeconds: 900 }, { durationSeconds: 600 }, { durationSeconds: 1200 }];

describe('resolveTimerClock', () => {
  it('keeps paused time unchanged', () => {
    expect(resolveTimerClock({
      status: TournamentTimerStatus.PAUSED,
      currentLevelIndex: 1,
      remainingSeconds: 321,
      startedAt: null,
      levels
    }, new Date('2026-07-27T12:00:00Z'))).toEqual({
      status: TournamentTimerStatus.PAUSED,
      currentLevelIndex: 1,
      remainingSeconds: 321
    });
  });

  it('subtracts elapsed time while running', () => {
    expect(resolveTimerClock({
      status: TournamentTimerStatus.RUNNING,
      currentLevelIndex: 0,
      remainingSeconds: 900,
      startedAt: new Date('2026-07-27T12:00:00Z'),
      levels
    }, new Date('2026-07-27T12:02:30Z'))).toMatchObject({
      status: TournamentTimerStatus.RUNNING,
      currentLevelIndex: 0,
      remainingSeconds: 750
    });
  });

  it('advances through multiple levels after sleep', () => {
    expect(resolveTimerClock({
      status: TournamentTimerStatus.RUNNING,
      currentLevelIndex: 0,
      remainingSeconds: 60,
      startedAt: new Date('2026-07-27T12:00:00Z'),
      levels
    }, new Date('2026-07-27T12:12:00Z'))).toMatchObject({
      status: TournamentTimerStatus.RUNNING,
      currentLevelIndex: 2,
      remainingSeconds: 1140
    });
  });

  it('finishes after the final level', () => {
    expect(resolveTimerClock({
      status: TournamentTimerStatus.RUNNING,
      currentLevelIndex: 2,
      remainingSeconds: 10,
      startedAt: new Date('2026-07-27T12:00:00Z'),
      levels
    }, new Date('2026-07-27T12:01:00Z'))).toEqual({
      status: TournamentTimerStatus.FINISHED,
      currentLevelIndex: 2,
      remainingSeconds: 0
    });
  });

  it('keeps a manually finished timer at zero', () => {
    expect(resolveTimerClock({
      status: TournamentTimerStatus.FINISHED,
      currentLevelIndex: 2,
      remainingSeconds: 0,
      startedAt: null,
      levels
    })).toMatchObject({ status: TournamentTimerStatus.FINISHED, remainingSeconds: 0 });
  });
});
