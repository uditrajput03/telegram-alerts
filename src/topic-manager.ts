import { AlertPayload, Env } from './types';
import { formatTopicTitle, getTopicColor, SYSTEM_TOPICS } from './config';
import { createTelegramForumTopic } from './telegram';

export interface TopicResolutionResult {
  topicId?: number;
  topicName: string;
  isFallback?: boolean;
  warning?: string;
}

/**
 * Resolves or dynamically creates Telegram Forum Topics.
 *
 * System Topics:
 * 1. 'unknown'  -> Used for messages sent without authentication.
 * 2. 'catchall' -> Used for raw HTTP dumps / structurally malformed payloads.
 * 3. 'general'  -> Used when no topic is specified or as ultimate fallback (thread ID null).
 *
 * All other topics are 100% dynamic:
 * - Checked in Cloudflare KV cache.
 * - If not found, created on demand via Telegram Bot API (createForumTopic).
 * - Thread ID is saved in KV for zero-latency subsequent delivery.
 */
export async function resolveTopicId(
  payload: AlertPayload,
  isVerified: boolean,
  env: Env
): Promise<TopicResolutionResult> {
  const chatId = env.TELEGRAM_CHAT_ID;
  const botToken = env.TELEGRAM_BOT_TOKEN;

  // 1. Catch-all / malformed / raw HTTP recovery payloads -> strictly routed to 'catchall' topic
  if (payload.is_catchall) {
    return await getOrCreateTopic(SYSTEM_TOPICS.CATCHALL, env.CATCHALL_TOPIC_ID, env, botToken, chatId);
  }

  // 2. Inbox topic requests -> strictly delivered to 'inbox' topic whether authenticated or not
  const rawTopic = payload.topic;
  const topicName = typeof rawTopic === 'string' ? rawTopic.trim().toLowerCase() : '';
  if (topicName === SYSTEM_TOPICS.INBOX || topicName === 'inbox') {
    return await getOrCreateTopic(SYSTEM_TOPICS.INBOX, env.INBOX_TOPIC_ID, env, botToken, chatId);
  }

  // 3. Unauthenticated standard requests -> strictly routed to 'unknown' topic (SEC-03 fix: cannot override topic_id)
  if (!isVerified) {
    return await getOrCreateTopic(SYSTEM_TOPICS.UNKNOWN, env.UNKNOWN_TOPIC_ID, env, botToken, chatId);
  }

  // 3. Explicit numeric topic_id or numeric topic parameter (verified requests only)
  const rawNumeric = payload.topic_id ?? (typeof payload.topic === 'number' ? payload.topic : undefined);
  if (rawNumeric !== undefined && rawNumeric !== null && rawNumeric !== '') {
    const parsed = typeof rawNumeric === 'number' ? rawNumeric : parseInt(String(rawNumeric), 10);
    if (!isNaN(parsed) && parsed > 0) {
      return { topicId: parsed, topicName: `topic-${parsed}` };
    }
  }

  // 4. Numeric string topic name (e.g. topic "123")
  if (typeof rawTopic === 'string' && /^\d+$/.test(rawTopic.trim())) {
    const parsed = parseInt(rawTopic.trim(), 10);
    if (parsed > 0) {
      return { topicId: parsed, topicName: `topic-${parsed}` };
    }
  }

  // 5. No topic specified -> default to General (null thread ID)
  if (!topicName || topicName === SYSTEM_TOPICS.GENERAL) {
    return {
      topicId: undefined,
      topicName: SYSTEM_TOPICS.GENERAL,
      isFallback: true,
    };
  }

  // 6. Dynamic Topic Resolution & Creation for any custom topic name
  return await getOrCreateTopic(topicName, undefined, env, botToken, chatId);
}

/**
 * Helper to fetch a topic from KV or dynamically create it via Telegram Bot API
 */
async function getOrCreateTopic(
  topicName: string,
  envOverrideId: string | undefined,
  env: Env,
  botToken?: string,
  chatId?: string | number
): Promise<TopicResolutionResult> {
  const cleanName = topicName.trim().toLowerCase();

  // A. Check environment variable override if provided
  if (envOverrideId) {
    const parsed = parseInt(envOverrideId.trim(), 10);
    if (!isNaN(parsed) && parsed > 0) {
      return { topicId: parsed, topicName: cleanName };
    }
  }

  // B. Check Cloudflare KV cache
  if (env.GATEWAY_KV) {
    try {
      const cached = await env.GATEWAY_KV.get(`topic:${cleanName}`);
      if (cached) {
        const parsed = parseInt(cached, 10);
        if (!isNaN(parsed) && parsed > 0) {
          return { topicId: parsed, topicName: cleanName };
        }
      }
    } catch (err) {
      console.warn(`[KV] Failed to read topic cache for "${cleanName}":`, err);
    }
  }

  // C. Dynamically create topic via Telegram createForumTopic API
  if (botToken && chatId) {
    try {
      const title = formatTopicTitle(cleanName);
      const iconColor = getTopicColor(cleanName);

      const created = await createTelegramForumTopic(botToken, chatId, title, iconColor);

      // Save in KV
      if (env.GATEWAY_KV && created.message_thread_id) {
        try {
          await env.GATEWAY_KV.put(`topic:${cleanName}`, String(created.message_thread_id));
          await updateTopicIndex(env.GATEWAY_KV, cleanName, created.message_thread_id);
        } catch (kvErr) {
          console.warn(`[KV] Failed to cache newly created topic for "${cleanName}":`, kvErr);
        }
      }

      return {
        topicId: created.message_thread_id,
        topicName: cleanName,
      };
    } catch (err: any) {
      const errMsg = err.message || 'Unknown error';
      console.warn(`[TopicManager] Failed to create Telegram topic "${cleanName}": ${errMsg}`);

      return {
        topicId: undefined,
        topicName: cleanName,
        isFallback: true,
        warning: `Could not auto-create topic "${cleanName}" (${errMsg}). Delivered to General.`,
      };
    }
  }

  // Fallback to General
  return {
    topicId: undefined,
    topicName: cleanName,
    isFallback: true,
    warning: 'Delivered to General.',
  };
}

async function updateTopicIndex(kv: KVNamespace, cleanName: string, threadId: number): Promise<void> {
  try {
    const indexKey = 'topics:index';
    const existingRaw = await kv.get(indexKey, 'json');
    const index: Record<string, number> = (existingRaw && typeof existingRaw === 'object') ? (existingRaw as any) : {};
    index[cleanName] = threadId;
    await kv.put(indexKey, JSON.stringify(index));
  } catch (err) {
    console.warn(`[KV] Failed to update topic index for "${cleanName}":`, err);
  }
}

/**
 * Self-healing: Purges a stale topic thread ID from KV and dynamically creates a fresh topic.
 */
export async function recreateTopic(
  topicName: string,
  env: Env
): Promise<TopicResolutionResult> {
  const chatId = env.TELEGRAM_CHAT_ID;
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const cleanName = topicName.trim().toLowerCase();

  // 1. Purge stale KV cache
  if (env.GATEWAY_KV) {
    try {
      await env.GATEWAY_KV.delete(`topic:${cleanName}`);
      const indexKey = 'topics:index';
      const existingRaw = await env.GATEWAY_KV.get(indexKey, 'json');
      if (existingRaw && typeof existingRaw === 'object') {
        const index = { ...(existingRaw as Record<string, number>) };
        delete index[cleanName];
        await env.GATEWAY_KV.put(indexKey, JSON.stringify(index));
      }
    } catch (err) {
      console.warn(`[TopicManager] Failed to purge stale topic "${cleanName}" from KV:`, err);
    }
  }

  // 2. Directly create fresh Telegram topic without reading stale KV cache
  if (botToken && chatId) {
    try {
      const title = formatTopicTitle(cleanName);
      const iconColor = getTopicColor(cleanName);
      const created = await createTelegramForumTopic(botToken, chatId, title, iconColor);

      if (env.GATEWAY_KV && created.message_thread_id) {
        try {
          await env.GATEWAY_KV.put(`topic:${cleanName}`, String(created.message_thread_id));
          await updateTopicIndex(env.GATEWAY_KV, cleanName, created.message_thread_id);
        } catch (kvErr) {
          console.warn(`[KV] Failed to cache recreated topic for "${cleanName}":`, kvErr);
        }
      }

      return {
        topicId: created.message_thread_id,
        topicName: cleanName,
      };
    } catch (err: any) {
      const errMsg = err.message || 'Unknown error';
      console.warn(`[TopicManager] Failed to recreate Telegram topic "${cleanName}": ${errMsg}`);
      return {
        topicId: undefined,
        topicName: cleanName,
        isFallback: true,
        warning: `Could not auto-recreate topic "${cleanName}" (${errMsg}). Delivered to General.`,
      };
    }
  }

  return {
    topicId: undefined,
    topicName: cleanName,
    isFallback: true,
    warning: 'Delivered to General.',
  };
}
