import { TournamentRegistrationStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  canPlayerCancelRegistration,
  canRegisterForTournamentStatus,
  canTransitionRegistrationStatus,
  isOccupiedRegistration,
  nextRegistrationStatus,
  shouldNotifyRegistrationStatusChange
} from './registrations.js';

describe('tournament registration rules', () => {
  it('uses the main list until capacity is reached', () => {
    expect(nextRegistrationStatus(47, 48)).toBe(TournamentRegistrationStatus.REGISTERED);
    expect(nextRegistrationStatus(48, 48)).toBe(TournamentRegistrationStatus.WAITLISTED);
  });

  it('counts checked-in and played users as occupied seats', () => {
    expect(isOccupiedRegistration(TournamentRegistrationStatus.REGISTERED)).toBe(true);
    expect(isOccupiedRegistration(TournamentRegistrationStatus.CHECKED_IN)).toBe(true);
    expect(isOccupiedRegistration(TournamentRegistrationStatus.PLAYED)).toBe(true);
    expect(isOccupiedRegistration(TournamentRegistrationStatus.WAITLISTED)).toBe(false);
    expect(isOccupiedRegistration(TournamentRegistrationStatus.CANCELLED)).toBe(false);
  });

  it('allows a player to cancel only an upcoming, unplayed registration', () => {
    expect(canPlayerCancelRegistration('UPCOMING', TournamentRegistrationStatus.REGISTERED)).toBe(true);
    expect(canPlayerCancelRegistration('UPCOMING', TournamentRegistrationStatus.WAITLISTED)).toBe(true);
    expect(canPlayerCancelRegistration('ACTIVE', TournamentRegistrationStatus.REGISTERED)).toBe(false);
    expect(canPlayerCancelRegistration('UPCOMING', TournamentRegistrationStatus.CHECKED_IN)).toBe(false);
    expect(canPlayerCancelRegistration('FINISHED', TournamentRegistrationStatus.PLAYED)).toBe(false);
  });

  it('keeps late registration open while the tournament is active', () => {
    expect(canRegisterForTournamentStatus('UPCOMING')).toBe(true);
    expect(canRegisterForTournamentStatus('ACTIVE')).toBe(true);
    expect(canRegisterForTournamentStatus('FINISHED')).toBe(false);
    expect(canRegisterForTournamentStatus('CANCELLED')).toBe(false);
  });

  it('makes check-in irreversible while still allowing the played transition', () => {
    expect(canTransitionRegistrationStatus(TournamentRegistrationStatus.REGISTERED, TournamentRegistrationStatus.CHECKED_IN)).toBe(true);
    expect(canTransitionRegistrationStatus(TournamentRegistrationStatus.CHECKED_IN, TournamentRegistrationStatus.PLAYED)).toBe(true);
    expect(canTransitionRegistrationStatus(TournamentRegistrationStatus.CHECKED_IN, TournamentRegistrationStatus.REGISTERED)).toBe(false);
    expect(canTransitionRegistrationStatus(TournamentRegistrationStatus.CHECKED_IN, TournamentRegistrationStatus.CANCELLED)).toBe(false);
    expect(canTransitionRegistrationStatus(TournamentRegistrationStatus.PLAYED, TournamentRegistrationStatus.CHECKED_IN)).toBe(false);
  });

  it('does not spam players with internal check-in status changes', () => {
    expect(shouldNotifyRegistrationStatusChange(TournamentRegistrationStatus.REGISTERED, TournamentRegistrationStatus.CHECKED_IN)).toBe(false);
    expect(shouldNotifyRegistrationStatusChange(TournamentRegistrationStatus.CHECKED_IN, TournamentRegistrationStatus.REGISTERED)).toBe(false);
    expect(shouldNotifyRegistrationStatusChange(TournamentRegistrationStatus.WAITLISTED, TournamentRegistrationStatus.REGISTERED)).toBe(true);
    expect(shouldNotifyRegistrationStatusChange(TournamentRegistrationStatus.REGISTERED, TournamentRegistrationStatus.CANCELLED)).toBe(true);
  });
});
