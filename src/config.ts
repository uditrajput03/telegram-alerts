/**
 * Telegram Forum Topic Colors & System Topic Definitions
 */

// Supported Telegram forum topic icon colors
export const TELEGRAM_TOPIC_COLORS = {
  BLUE: 0x6FB9F0,
  YELLOW: 0xFFD67E,
  PURPLE: 0xCB86DB,
  GREEN: 0x8EEE98,
  PINK: 0xFF93AC,
  RED: 0xFB6F5F,
} as const;

// Dedicated system topics required by the gateway
export const SYSTEM_TOPICS = {
  UNKNOWN: 'unknown',   // Messages sent without authentication
  CATCHALL: 'catchall', // Raw / malformed / structural recovery messages
  GENERAL: 'general',   // Default fallback (main thread)
} as const;

/**
 * Returns an intuitive icon color for dynamic topics
 */
export function getTopicColor(topicName: string): number {
  const clean = topicName.toLowerCase();
  if (clean === SYSTEM_TOPICS.UNKNOWN) return TELEGRAM_TOPIC_COLORS.RED;
  if (clean === SYSTEM_TOPICS.CATCHALL) return TELEGRAM_TOPIC_COLORS.YELLOW;

  // Hash topic name to pick one of the 6 Telegram colors consistently
  const colors: number[] = [
    TELEGRAM_TOPIC_COLORS.BLUE,
    TELEGRAM_TOPIC_COLORS.GREEN,
    TELEGRAM_TOPIC_COLORS.PURPLE,
    TELEGRAM_TOPIC_COLORS.YELLOW,
    TELEGRAM_TOPIC_COLORS.PINK,
    TELEGRAM_TOPIC_COLORS.RED,
  ];

  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash << 5) - hash + clean.charCodeAt(i);
    hash |= 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Formats a topic name for Telegram Forum Topic creation
 */
export function formatTopicTitle(topicName: string): string {
  const clean = topicName.trim().toLowerCase();
  if (clean === SYSTEM_TOPICS.UNKNOWN) return '⚠️ Unknown (No Auth)';
  if (clean === SYSTEM_TOPICS.CATCHALL) return '📦 Catch-All (Raw Payloads)';

  // Capitalize word
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
