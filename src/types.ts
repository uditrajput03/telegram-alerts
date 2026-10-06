/**
 * Cloudflare Worker Environment Bindings
 */
export interface Env {
  // Secrets (wrangler secret put)
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID?: string;
  AUTH_TOKEN?: string; // Static master auth token
  ADMIN_USER_ID?: string; // Optional: Restrict /token bot commands to specific Telegram User ID(s)
  TELEGRAM_WEBHOOK_SECRET?: string; // Optional: Telegram webhook verification secret

  // Optional Environment Overrides for System Topics
  UNKNOWN_TOPIC_ID?: string;  // Predefined topic ID for unauthenticated messages
  CATCHALL_TOPIC_ID?: string; // Predefined topic ID for raw / structural recovery messages

  // Optional Quiet Hours (Disabled by default)
  QUIET_HOURS_START?: string;
  QUIET_HOURS_END?: string;
  TIMEZONE?: string;

  // Cloudflare KV Namespace for dynamic topics & bot tokens
  GATEWAY_KV?: KVNamespace;
}

/**
 * 3 Authentication Token Types
 */
export type TokenType = 'env' | 'permanent' | 'ephemeral';

export interface StoredToken {
  token: string;
  type: 'permanent' | 'ephemeral';
  label: string;
  createdAt: number;
  expiresAt?: number;
  createdBy: string;
}

export interface AuthVerificationResult {
  verified: boolean;
  tokenType?: TokenType;
  tokenLabel?: string;
}

/**
 * Incoming Alert Payload
 */
export interface AlertPayload {
  message?: string;
  title?: string;
  topic?: string | number; // String topic name (e.g. "deploy", "database") or numeric ID
  silent?: boolean;
  topic_id?: number | string;
  raw_body?: string;
  raw_query?: Record<string, string>;
  raw_path?: string;
  is_catchall?: boolean;
}

/**
 * Telegram API Response Types
 */
export interface TelegramResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface TelegramMessageResult {
  message_id: number;
  message_thread_id?: number;
  date: number;
  chat: {
    id: number;
    title?: string;
    type: string;
  };
  text?: string;
}

export interface TelegramForumTopicResult {
  message_thread_id: number;
  name: string;
  icon_color: number;
  icon_custom_emoji_id?: string;
}

export interface TelegramChatMember {
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
  user: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    message_thread_id?: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      title?: string;
      type: 'private' | 'group' | 'supergroup' | 'channel';
    };
    date: number;
    text?: string;
  };
}

/**
 * Gateway Output Response
 */
export interface GatewayResponse {
  success: boolean;
  message_id?: number;
  topic?: string;           // Named topic (e.g. "database", "unknown", "catchall")
  topic_id?: number | null; // Numeric Telegram message_thread_id
  target_topic_id?: number | null;
  delivered_to?: string;    // e.g. "Topic 42" or "General"
  silent?: boolean;
  is_verified: boolean;
  is_catchall?: boolean;
  token_type?: TokenType | null;
  warning?: string;
  error?: string;
  details?: unknown;
}
