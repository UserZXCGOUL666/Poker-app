import { describe, expect, it } from 'vitest';
import { buildSeatingPlan } from './seating.js';

describe('buildSeatingPlan', () => {
  it('равномерно распределяет игроков и не повторяет места', () => {
    const players = Array.from({ length: 38 }, (_, index) => `player-${index + 1}`);
    const plan = buildSeatingPlan(players, 8, undefined, 'fixed-seed');
    expect(plan.tableCount).toBe(5);
    expect(plan.tables.map((table) => table.userSeats.length)).toEqual([8, 8, 8, 7, 7]);
    expect(new Set(plan.tables.flatMap((table) => table.userSeats.map((seat) => seat.userId))).size).toBe(38);
    for (const table of plan.tables) {
      expect(new Set(table.userSeats.map((seat) => seat.seatNumber)).size).toBe(table.userSeats.length);
      expect(Math.max(...table.userSeats.map((seat) => seat.seatNumber))).toBeLessThanOrEqual(8);
    }
  });

  it('даёт воспроизводимый результат для сохранённого seed', () => {
    const players = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(buildSeatingPlan(players, 4, 2, 'audit-seed')).toEqual(buildSeatingPlan(players, 4, 2, 'audit-seed'));
  });

  it('отклоняет недостаточное количество столов', () => {
    expect(() => buildSeatingPlan(Array.from({ length: 17 }, (_, index) => String(index)), 8, 2, 'seed')).toThrow(/требуется от 3/);
  });
});
