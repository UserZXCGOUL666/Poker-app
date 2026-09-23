export type AnalyticsPeriod = '7d' | '30d' | '90d' | 'season';

const periodDays: Record<Exclude<AnalyticsPeriod, 'season'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90
};

export function resolveAnalyticsPeriod(period: AnalyticsPeriod, now: Date, seasonStart?: Date | null) {
  const fallbackDays = period === 'season' ? 90 : periodDays[period];
  const from = period === 'season' && seasonStart && seasonStart < now
    ? new Date(seasonStart)
    : new Date(now.getTime() - fallbackDays * 86_400_000);
  const duration = Math.max(86_400_000, now.getTime() - from.getTime());
  return {
    from,
    to: new Date(now),
    previousFrom: new Date(from.getTime() - duration),
    previousTo: new Date(from),
    label: period === 'season' && seasonStart && seasonStart < now ? 'Текущий сезон' : `Последние ${fallbackDays} дней`
  };
}

export function percentage(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((value / total) * 1000) / 10;
}

export function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

export function trend(current: number, previous: number) {
  return {
    current,
    previous,
    deltaPercent: previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10
  };
}

export function dayKeysBetween(from: Date, to: Date) {
  const startKey = from.toISOString().slice(0, 10);
  const endKey = to.toISOString().slice(0, 10);
  const cursor = new Date(`${startKey}T00:00:00.000Z`);
  const end = new Date(`${endKey}T00:00:00.000Z`);
  const keys: string[] = [];
  while (cursor <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

export function uniqueCount(values: string[]) {
  return new Set(values).size;
}
