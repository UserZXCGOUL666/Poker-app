import { describe, expect, it } from 'vitest';
import type { TournamentTimer } from '../types';
import { resolveTimerDisplay, timerClock } from './tournamentTimer';

const timer: TournamentTimer = {
  id: 'timer',
  tournamentId: 'tournament',
  tournament: { id: 'tournament', title: 'Test', status: 'ACTIVE' },
  status: 'RUNNING',
  currentLevelIndex: 0,
  remainingSeconds: 30,
  serverNow: '2026-07-27T12:00:00.000Z',
  updatedAt: '2026-07-27T12:00:00.000Z',
  topTicker: null,
  bottomTicker: null,
  tickerSpeed: 28,
  levels: [
    { id: '1', position: 0, kind: 'LEVEL', durationSeconds: 60, smallBlind: 25, bigBlind: 50, ante: 0, label: null },
    { id: '2', position: 1, kind: 'BREAK', durationSeconds: 120, smallBlind: null, bigBlind: null, ante: null, label: 'Перерыв' }
  ]
};

describe('tournament timer display', () => {
  it('counts down from the server anchor', () => {
    expect(resolveTimerDisplay(timer, new Date('2026-07-27T12:00:10.000Z').getTime()).remainingSeconds).toBe(20);
  });

  it('moves to the next level locally', () => {
    const result = resolveTimerDisplay(timer, new Date('2026-07-27T12:00:45.000Z').getTime());
    expect(result.currentLevelIndex).toBe(1);
    expect(result.remainingSeconds).toBe(105);
  });

  it('formats clocks', () => {
    expect(timerClock(65)).toBe('01:05');
    expect(timerClock(3661)).toBe('1:01:01');
  });
});
