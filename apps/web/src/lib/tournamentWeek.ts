import type { TournamentStatus } from '../types';

export type TournamentVisualState = 'upcoming' | 'active' | 'finished' | 'cancelled';

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfLocalDay(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function startOfLocalWeek(value: Date) {
  const result = startOfLocalDay(value);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

export function addLocalDays(value: Date, amount: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + amount);
  return result;
}

export function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDayNumber(value: Date) {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / DAY_MS;
}

export function weekOffsetForDate(value: Date, now = new Date()) {
  return Math.round((localDayNumber(startOfLocalWeek(value)) - localDayNumber(startOfLocalWeek(now))) / 7);
}

export function tournamentVisualState(status: TournamentStatus, startsAt: string, now = new Date()): TournamentVisualState {
  if (status === 'ACTIVE') return 'active';
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'FINISHED' || startOfLocalDay(new Date(startsAt)) < startOfLocalDay(now)) return 'finished';
  return 'upcoming';
}

