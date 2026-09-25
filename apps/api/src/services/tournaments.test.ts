import { describe, expect, it } from 'vitest';
import { participantsFitCapacity } from './tournaments.js';

describe('participantsFitCapacity', () => {
  it('allows a full tournament but rejects overbooking', () => {
    expect(participantsFitCapacity(48, 48)).toBe(true);
    expect(participantsFitCapacity(49, 48)).toBe(false);
  });
});
