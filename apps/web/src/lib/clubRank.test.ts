import { describe, expect, it } from 'vitest';
import { clubRankProgress } from './clubRank';

describe('clubRankProgress', () => {
  it('starts a new player at the first rank', () => {
    expect(clubRankProgress(0)).toMatchObject({
      rank: { name: 'Бронза I' },
      nextRank: { name: 'Бронза II' },
      xpToNext: 250,
      progress: 0
    });
  });

  it('moves to the next rank exactly at its threshold', () => {
    expect(clubRankProgress(250)).toMatchObject({
      rank: { name: 'Бронза II' },
      nextRank: { name: 'Бронза III' },
      xpToNext: 500,
      progress: 0
    });
  });

  it('shows progress within a rank', () => {
    expect(clubRankProgress(500)).toMatchObject({
      rank: { name: 'Бронза II' },
      xpToNext: 250,
      progress: 50
    });
  });

  it('keeps the maximum rank stable', () => {
    expect(clubRankProgress(50_000)).toMatchObject({
      rank: { name: 'Платина' },
      nextRank: null,
      xpToNext: 0,
      progress: 100
    });
  });
});
