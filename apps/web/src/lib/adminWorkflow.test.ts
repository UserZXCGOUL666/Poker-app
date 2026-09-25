import { describe, expect, it } from 'vitest';
import { deriveAdminWorkflow, type AdminFocusTournament } from './adminWorkflow';

function tournament(patch: Partial<AdminFocusTournament> = {}): AdminFocusTournament {
  return {
    id: 't1', title: 'Турнир', startsAt: '2030-01-01T20:00:00.000Z', location: 'Клуб', capacity: 48,
    participantCount: 3, status: 'UPCOMING', registrationClosed: false, seatingPublishedAt: null, seatingVersion: 0,
    season: { name: 'Сезон 1' },
    registrationCounts: { registered: 3, waitlisted: 0, checked_in: 0, played: 0, cancelled: 0 },
    _count: { results: 0, notifications: 0, tables: 0, seats: 0, pointBatches: 0 },
    ...patch
  };
}

describe('deriveAdminWorkflow', () => {
  it('keeps a future tournament in preparation', () => {
    expect(deriveAdminWorkflow(tournament(), new Date('2029-12-31T10:00:00.000Z')).stage).toBe('PREPARE');
  });

  it('opens check-in during the six-hour window', () => {
    expect(deriveAdminWorkflow(tournament(), new Date('2030-01-01T16:00:00.000Z')).stage).toBe('CHECK_IN');
  });

  it('requires seating after the first confirmed arrival', () => {
    const value = tournament({ registrationCounts: { registered: 2, waitlisted: 0, checked_in: 1, played: 0, cancelled: 0 } });
    expect(deriveAdminWorkflow(value).stage).toBe('SEATING');
  });

  it('never skips point approval after results', () => {
    const value = tournament({ status: 'FINISHED', _count: { results: 3, notifications: 1, tables: 1, seats: 3, pointBatches: 0 } });
    expect(deriveAdminWorkflow(value).stage).toBe('POINTS');
  });

  it('marks the cycle done only after a point batch exists', () => {
    const value = tournament({ status: 'FINISHED', _count: { results: 3, notifications: 1, tables: 1, seats: 3, pointBatches: 1 } });
    expect(deriveAdminWorkflow(value).stage).toBe('DONE');
  });
});
