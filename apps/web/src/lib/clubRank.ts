export const clubRanks = [
  { name: 'Бронза I', minXp: 0 },
  { name: 'Бронза II', minXp: 250 },
  { name: 'Бронза III', minXp: 750 },
  { name: 'Серебро I', minXp: 1_500 },
  { name: 'Серебро II', minXp: 2_500 },
  { name: 'Серебро III', minXp: 4_000 },
  { name: 'Золото I', minXp: 6_000 },
  { name: 'Золото II', minXp: 8_500 },
  { name: 'Золото III', minXp: 12_000 },
  { name: 'Платина', minXp: 16_000 }
] as const;

export function clubRankProgress(value: number) {
  const xp = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  let index = 0;
  for (let current = 1; current < clubRanks.length; current += 1) {
    if (xp < clubRanks[current].minXp) break;
    index = current;
  }
  const rank = clubRanks[index];
  const nextRank = clubRanks[index + 1] ?? null;
  const progress = nextRank
    ? Math.min(100, Math.max(0, (xp - rank.minXp) / (nextRank.minXp - rank.minXp) * 100))
    : 100;
  return {
    xp,
    rank,
    nextRank,
    xpToNext: nextRank ? nextRank.minXp - xp : 0,
    progress
  };
}
