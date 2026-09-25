import { describe, expect, it } from 'vitest';
import { initials, points } from './format';

describe('formatters', () => {
  it('форматирует инициалы', () => expect(initials('Алексей', 'Ковалёв')).toBe('АК'));
  it('форматирует очки', () => expect(points(2460).replace(/\s/g, '')).toBe('2460'));
});
