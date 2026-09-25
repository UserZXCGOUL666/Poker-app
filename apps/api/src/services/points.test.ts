import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import { calculateBalanceAfter } from './points.js';

describe('calculateBalanceAfter', () => {
  it('начисляет очки', () => expect(calculateBalanceAfter(240, 100)).toBe(340));
  it('списывает очки', () => expect(calculateBalanceAfter(240, -40)).toBe(200));
  it('не допускает отрицательный баланс', () => {
    expect(() => calculateBalanceAfter(50, -51)).toThrow(AppError);
  });
});
