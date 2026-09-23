import { describe, expect, it } from 'vitest';
import {
  createRetryableInitializer,
  displayName,
  hasAdminAccess,
  miniAppLaunchUrl,
  miniAppUrl,
  normalizePhoneNumber,
  normalizeTelegramWebhookSecret,
  registrationLabel
} from './botHelpers.js';

describe('retryable initialization', () => {
  it('shares one initialization between concurrent webhook requests', async () => {
    let calls = 0;
    const initialize = createRetryableInitializer(async () => {
      calls += 1;
      await Promise.resolve();
    });

    await Promise.all([initialize(), initialize(), initialize()]);

    expect(calls).toBe(1);
  });

  it('allows a retry after a failed initialization', async () => {
    let calls = 0;
    const initialize = createRetryableInitializer(async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary Telegram error');
    });

    await expect(initialize()).rejects.toThrow('temporary Telegram error');
    await expect(initialize()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});

describe('bot helpers', () => {
  it('builds Mini App deep links without keeping stale query parameters', () => {
    expect(miniAppUrl('https://club.example/?old=1', '/admin', { section: 'seating' }))
      .toBe('https://club.example/admin?section=seating');
  });

  it('opens player sections through the canonical Mini App entry point', () => {
    expect(miniAppLaunchUrl('https://club.example/old?stale=1', 'games'))
      .toBe('https://club.example/?view=games');
  });

  it('normalizes own Telegram contact numbers', () => {
    expect(normalizePhoneNumber('+7 (999) 123-45-67')).toBe('+79991234567');
    expect(normalizePhoneNumber('0049 151 1234567')).toBe('+491511234567');
    expect(normalizePhoneNumber('123')).toBeNull();
  });

  it('uses username when available', () => {
    expect(displayName({ firstName: 'Анна', username: 'anna', nickname: 'River Queen' })).toBe('River Queen');
    expect(displayName({ firstName: 'Анна', username: 'anna' })).toBe('@anna');
    expect(displayName({ firstName: 'Анна', lastName: 'Иванова' })).toBe('Анна Иванова');
  });

  it('describes late registration separately from a scheduled tournament', () => {
    const common = { registrationClosed: false, registrationDeadline: null, participantCount: 12, capacity: 24 };
    expect(registrationLabel({ ...common, status: 'ACTIVE' })).toContain('поздняя');
    expect(registrationLabel({ ...common, status: 'UPCOMING' })).toBe('регистрация открыта');
  });

  it('does not grant admin access to a forged Telegram ID', () => {
    const adminIds = new Set(['111', '222']);
    expect(hasAdminAccess(111, adminIds)).toBe(true);
    expect(hasAdminAccess(333, adminIds)).toBe(false);
  });

  it('keeps Telegram-safe webhook secrets unchanged', () => {
    expect(normalizeTelegramWebhookSecret('valid_Secret-123')).toBe('valid_Secret-123');
  });

  it('derives a Telegram-safe secret from Render-generated values', () => {
    const normalized = normalizeTelegramWebhookSecret('render/generated+secret=');
    expect(normalized).toMatch(/^[a-f0-9]{64}$/);
    expect(normalized).toBe(normalizeTelegramWebhookSecret('render/generated+secret='));
  });
});
