import { describe, it, expect } from 'vitest';
import { isQuietHours, shouldBeSilent } from '../src/quiet-hours';
import { Env } from '../src/types';

describe('Quiet Hours & Silence Evaluation', () => {
  const baseEnv: Env = {
    TELEGRAM_BOT_TOKEN: 'mock_token',
  };

  it('is disabled by default when start and end hours are not set', () => {
    expect(isQuietHours(baseEnv)).toBe(false);
  });

  it('detects quiet hours across midnight (23 to 07)', () => {
    const quietEnv: Env = {
      ...baseEnv,
      QUIET_HOURS_START: '23',
      QUIET_HOURS_END: '07',
      TIMEZONE: 'UTC',
    };

    // 03:00 UTC -> inside quiet window
    const insideDate = new Date('2026-10-06T03:00:00Z');
    expect(isQuietHours(quietEnv, insideDate)).toBe(true);

    // 23:30 UTC -> inside quiet window
    const lateNightDate = new Date('2026-10-06T23:30:00Z');
    expect(isQuietHours(quietEnv, lateNightDate)).toBe(true);

    // 12:00 UTC -> outside quiet window
    const outsideDate = new Date('2026-10-06T12:00:00Z');
    expect(isQuietHours(quietEnv, outsideDate)).toBe(false);
  });

  it('forces silence for unverified alerts always', () => {
    const silent = shouldBeSilent(
      { message: 'Test message', topic: 'billing' },
      false, // unverified
      baseEnv
    );
    expect(silent).toBe(true);
  });

  it('defaults catchall recovery payloads to silent', () => {
    const silent = shouldBeSilent(
      { is_catchall: true, raw_body: 'something' },
      true, // verified
      baseEnv
    );
    expect(silent).toBe(true);
  });

  it('mutes alerts during quiet hours', () => {
    const quietEnv: Env = {
      ...baseEnv,
      QUIET_HOURS_START: '23',
      QUIET_HOURS_END: '07',
      TIMEZONE: 'UTC',
    };
    const midnight = new Date('2026-10-06T02:00:00Z');

    const silent = shouldBeSilent(
      { message: 'New order #1234', topic: 'sales' },
      true, // verified
      quietEnv,
      midnight
    );
    expect(silent).toBe(true);
  });

  it('delivers loud during normal daytime hours by default', () => {
    const quietEnv: Env = {
      ...baseEnv,
      QUIET_HOURS_START: '23',
      QUIET_HOURS_END: '07',
      TIMEZONE: 'UTC',
    };
    const daytime = new Date('2026-10-06T14:00:00Z');
    const silent = shouldBeSilent(
      { message: 'Build #42 started', topic: 'ci' },
      true,
      quietEnv,
      daytime
    );
    expect(silent).toBe(false);
  });
});
