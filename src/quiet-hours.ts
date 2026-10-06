import { AlertPayload, Env } from './types';
import { SYSTEM_TOPICS } from './config';

const quietHoursFormatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * Determines whether the given date/time is within configured Quiet Hours
 * Quiet hours are DISABLED by default unless both QUIET_HOURS_START and QUIET_HOURS_END are defined.
 */
export function isQuietHours(env: Env, date = new Date()): boolean {
  if (
    env.QUIET_HOURS_START === undefined ||
    env.QUIET_HOURS_START === '' ||
    env.QUIET_HOURS_END === undefined ||
    env.QUIET_HOURS_END === ''
  ) {
    return false;
  }

  const startHour = parseInt(env.QUIET_HOURS_START, 10);
  const endHour = parseInt(env.QUIET_HOURS_END, 10);

  if (isNaN(startHour) || isNaN(endHour)) {
    return false;
  }

  const tz = env.TIMEZONE || 'UTC';
  let currentHour: number;

  try {
    let formatter = quietHoursFormatterCache.get(tz);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        hour12: false,
      });
      quietHoursFormatterCache.set(tz, formatter);
    }
    const hourStr = formatter.format(date);
    currentHour = parseInt(hourStr, 10) % 24;
  } catch {
    currentHour = date.getUTCHours();
  }

  if (startHour <= endHour) {
    return currentHour >= startHour && currentHour < endHour;
  } else {
    return currentHour >= startHour || currentHour < endHour;
  }
}

/**
 * Determines whether the message should be delivered silently (`disable_notification: true`)
 *
 * Rules:
 * 1. Unverified requests: Always silent to prevent spam.
 * 2. Catch-all / raw dumps: Default to silent.
 * 3. Explicit `payload.silent`: Respected.
 * 4. Quiet Hours: Silenced if quiet hours active.
 * 5. Default: Loud delivery.
 */
export function shouldBeSilent(
  payload: AlertPayload,
  isVerified: boolean,
  env: Env,
  date = new Date()
): boolean {
  // 1. Explicit override
  if (typeof payload.silent === 'boolean') {
    return payload.silent;
  }

  // 2. Unverified requests: strictly silent (except inbox which follows normal delivery rules)
  const isInbox =
    typeof payload.topic === 'string' &&
    (payload.topic.toLowerCase() === 'inbox' || payload.topic.toLowerCase() === SYSTEM_TOPICS.INBOX);
  if (!isVerified && !isInbox) {
    return true;
  }

  // 3. Catch-all payloads are silent by default
  if (payload.is_catchall) {
    return payload.silent ?? true;
  }

  // 4. Quiet hours check
  if (isQuietHours(env, date)) {
    return true;
  }

  return false;
}
