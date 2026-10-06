import {
  TelegramChatMember,
  TelegramForumTopicResult,
  TelegramMessageResult,
  TelegramResponse,
} from './types';

export interface SendMessageOptions {
  threadId?: number;
  silent?: boolean;
  parseMode?: 'HTML' | 'MarkdownV2' | null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Error thrown when a forum topic thread has been deleted, closed, or not found on Telegram
 */
export class TelegramThreadNotFoundError extends Error {
  constructor(message: string, public threadId: number) {
    super(message);
    this.name = 'TelegramThreadNotFoundError';
  }
}

/**
 * Dispatches a message to Telegram using Bot API
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string | number,
  text: string,
  options: SendMessageOptions = {}
): Promise<TelegramMessageResult> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_notification: options.silent ?? false,
  };

  if (options.parseMode !== null) {
    body.parse_mode = options.parseMode ?? 'HTML';
  }

  if (options.threadId !== undefined && options.threadId !== null && options.threadId > 0) {
    body.message_thread_id = options.threadId;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as TelegramResponse<TelegramMessageResult>;

  if (!data.ok || !data.result) {
    // If delivery failed because a forum topic was deleted or closed, throw specialized error
    // so the caller can trigger self-healing (purging KV, re-creating the topic, and retrying)
    if (
      options.threadId &&
      data.description &&
      (data.description.includes('message thread not found') ||
        data.description.includes('TOPIC_DELETED') ||
        data.description.includes('TOPIC_CLOSED'))
    ) {
      throw new TelegramThreadNotFoundError(data.description, options.threadId);
    }

    // If delivery failed because of an HTML parsing error, retry once as plain text
    if (
      options.parseMode !== null &&
      data.description &&
      (data.description.toLowerCase().includes("can't parse entities") ||
        data.description.includes('ENTITY_PARSING_FAILED'))
    ) {
      console.warn(`[Telegram] HTML entity parse error (${data.description}). Retrying as plain text...`);
      return await sendTelegramMessage(botToken, chatId, stripHtml(text), {
        ...options,
        parseMode: null,
      });
    }

    throw new Error(
      `Telegram API error: ${data.description || 'Unknown error'} (code: ${data.error_code || response.status})`
    );
  }

  return data.result;
}

/**
 * Creates a new Forum Topic in a Telegram Supergroup
 */
export async function createTelegramForumTopic(
  botToken: string,
  chatId: string | number,
  name: string,
  iconColor?: number
): Promise<TelegramForumTopicResult> {
  const url = `https://api.telegram.org/bot${botToken}/createForumTopic`;

  // Telegram topic name length limit is 128 characters
  const safeName = name.slice(0, 128);

  const body: Record<string, unknown> = {
    chat_id: chatId,
    name: safeName,
  };

  if (iconColor !== undefined) {
    body.icon_color = iconColor;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as TelegramResponse<TelegramForumTopicResult>;

  if (!data.ok || !data.result) {
    throw new Error(
      `Failed to create Telegram forum topic "${name}": ${data.description || 'Unknown error'} (code: ${data.error_code || response.status})`
    );
  }

  return data.result;
}

/**
 * Sets the Telegram Webhook URL for receiving updates
 */
export async function setTelegramWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken?: string
): Promise<{ ok: boolean; description?: string }> {
  const url = `https://api.telegram.org/bot${botToken}/setWebhook`;

  const body: Record<string, unknown> = {
    url: webhookUrl,
    allowed_updates: ['message'],
    drop_pending_updates: false,
  };

  if (secretToken) {
    body.secret_token = secretToken;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return (await response.json()) as TelegramResponse<unknown>;
}

/**
 * Checks a user's membership status in a group
 */
export async function getChatMember(
  botToken: string,
  chatId: string | number,
  userId: number
): Promise<TelegramChatMember | null> {
  const url = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${chatId}&user_id=${userId}`;

  try {
    const response = await fetch(url);
    const data = (await response.json()) as TelegramResponse<TelegramChatMember>;
    if (data.ok && data.result) {
      return data.result;
    }
  } catch (err) {
    console.warn('[Telegram] Failed to get chat member:', err);
  }
  return null;
}

