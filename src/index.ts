import { Context, Hono } from 'hono';
import { Env, AlertPayload, GatewayResponse, TelegramMessageResult, TelegramUpdate } from './types';
import { verifyAuth } from './auth';
import { formatTelegramMessage } from './formatter';
import { shouldBeSilent } from './quiet-hours';
import { isTopicMuted } from './mute-manager';
import { resolveTopicId, recreateTopic } from './topic-manager';
import { sendTelegramMessage, setTelegramWebhook, TelegramThreadNotFoundError } from './telegram';
import { handleTelegramWebhook } from './telegram-bot';
import { SYSTEM_TOPICS } from './config';
import { renderSendPage } from './send-page';

const app = new Hono<{ Bindings: Env }>();

/**
 * Global Error Handler
 */
app.onError((err, c) => {
  console.error('[Gateway Error]', err);
  return c.json<GatewayResponse>(
    {
      success: false,
      is_verified: false,
      error: err.message || 'Internal Server Error',
    },
    500
  );
});

/**
 * Health Check Endpoint
 */
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'telegram-alerts',
  });
});

/**
 * Telegram Webhook Endpoint
 * Receives updates from Telegram when users send commands to the bot (/token, /settopic, /topics, /id, /start, /help)
 * Strictly requires TELEGRAM_WEBHOOK_SECRET to be configured and matched.
 */
app.post('/telegram-webhook', async (c) => {
  const env = c.env;

  // Strict enforcement: TELEGRAM_WEBHOOK_SECRET is mandatory
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    console.error('[Security] TELEGRAM_WEBHOOK_SECRET is not configured. Dropping webhook request.');
    return c.text('Unauthorized: Webhook secret not configured on server', 401);
  }

  const receivedSecret = c.req.header('x-telegram-bot-api-secret-token');
  if (receivedSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return c.text('Unauthorized', 401);
  }

  try {
    const update = (await c.req.json()) as TelegramUpdate;
    const host = new URL(c.req.url).host;

    let scheduledInBackground = false;
    try {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        c.executionCtx.waitUntil(handleTelegramWebhook(update, env, host));
        scheduledInBackground = true;
      }
    } catch {
      scheduledInBackground = false;
    }

    if (!scheduledInBackground) {
      await handleTelegramWebhook(update, env, host);
    }
  } catch (err) {
    console.error('[Telegram Webhook Error]', err);
  }

  return c.json({ ok: true });
});

/**
 * Informational GET handler for webhook verification
 */
app.get('/telegram-webhook', (c) => {
  const env = c.env;
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json(
      {
        status: 'unconfigured',
        error: 'TELEGRAM_WEBHOOK_SECRET is missing. Webhook calls are strictly blocked.',
      },
      503
    );
  }
  return c.json({
    status: 'active',
    message: 'Telegram webhook receiver is active and strictly protected by secret token.',
  });
});

/**
 * Endpoint to Register / Re-register Telegram Webhook
 * Securely sets the webhook URL with Telegram Bot API
 */
app.all('/setup-webhook', async (c) => {
  const env = c.env;
  if (!env.TELEGRAM_BOT_TOKEN) {
    return c.json({ error: 'TELEGRAM_BOT_TOKEN is not configured' }, 500);
  }

  // Strict enforcement: TELEGRAM_WEBHOOK_SECRET is required to register webhook
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json(
      {
        error:
          'TELEGRAM_WEBHOOK_SECRET is required. Configure it via `wrangler secret put TELEGRAM_WEBHOOK_SECRET` before registering the webhook.',
      },
      400
    );
  }

  // If AUTH_TOKEN is configured, verify authentication
  if (env.AUTH_TOKEN) {
    const authResult = await verifyAuth(c);
    if (!authResult.verified) {
      return c.json({ error: 'Unauthorized: valid token required to configure webhook' }, 401);
    }
  }

  const url = new URL(c.req.url);
  const webhookUrl = `${url.protocol}//${url.host}/telegram-webhook`;

  try {
    const result = await setTelegramWebhook(
      env.TELEGRAM_BOT_TOKEN,
      webhookUrl,
      env.TELEGRAM_WEBHOOK_SECRET
    );

    return c.json({
      success: result.ok,
      webhook_url: webhookUrl,
      telegram_response: result,
      instructions: result.ok
        ? 'Webhook registered successfully with strict secret token! Now open Telegram and send /help or /settopic to your bot.'
        : 'Failed to set webhook.',
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

/**
 * Core notification handler for GET and POST requests
 */
async function handleNotification(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;
  const authResult = await verifyAuth(c);
  const isVerified = authResult.verified;

  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!botToken) {
    return c.json<GatewayResponse>(
      {
        success: false,
        is_verified: isVerified,
        error: 'Server misconfiguration: TELEGRAM_BOT_TOKEN is not set.',
      },
      500
    );
  }

  if (!chatId) {
    return c.json<GatewayResponse>(
      {
        success: false,
        is_verified: isVerified,
        error: 'Server misconfiguration: TELEGRAM_CHAT_ID is not set.',
      },
      500
    );
  }

  // Parse incoming payload (recovering malformed/raw payloads as catch-all)
  const payload = await parseRequestPayload(c);

  // Check if request has actual content (SEC-04 fix: avoid scanner/probe spam)
  const isCustomPath = payload.raw_path && payload.raw_path !== '/' && payload.raw_path !== '/notify';
  const hasContent = Boolean(
    (payload.message && payload.message.trim() !== '') ||
    (payload.raw_body && payload.raw_body.trim() !== '') ||
    (payload.raw_query && Object.keys(payload.raw_query).length > 0) ||
    (isCustomPath && isVerified)
  );

  // If GET on root with no params or body, show clean API documentation
  if (c.req.method === 'GET' && c.req.path === '/' && !hasContent) {
    return c.json({
      service: 'Personal Notification Gateway',
      status: 'online',
      authenticated: isVerified,
      token_type: authResult.tokenType || null,
      usage: {
        post: 'POST /notify with JSON { "message": "...", "title": "...", "topic": "deploy" }',
        get: 'GET /notify?message=Hello+World&topic=database',
        raw: 'echo "hello" | curl -d @- -H "x-api-key: $AUTH_TOKEN" $GATEWAY_URL/notify?topic=ci',
        catchall: 'Any unstructured or raw webhook body is safely recovered in the "catchall" topic.',
      },
    });
  }

  // Reject empty payloads / scanner probes to prevent Telegram notification spam
  if (!hasContent) {
    return c.json<GatewayResponse>(
      {
        success: false,
        is_verified: isVerified,
        error: 'Missing content: "message" or payload body is required.',
      },
      400
    );
  }

  try {
    // 1. Resolve or dynamically create destination topic
    const topicResult = await resolveTopicId(payload, isVerified, env);
    let targetTopicId = topicResult.topicId;

    // 2. Determine silence / muting
    let silent = shouldBeSilent(payload, isVerified, env);
    if (!silent && topicResult.topicName) {
      const isMuted = await isTopicMuted(topicResult.topicName, env);
      if (isMuted) {
        silent = true;
      }
    }

    // 3. Format message safely as Telegram HTML
    const formattedText = formatTelegramMessage(payload, isVerified, {
      timezone: env.TIMEZONE,
    });

    // 4. Send to Telegram API with Self-Healing on deleted topics (Solution 1)
    let result: TelegramMessageResult;
    let deliveredTopicId: number | null = null;
    let warning = topicResult.warning;

    try {
      result = await sendTelegramMessage(botToken, chatId, formattedText, {
        threadId: targetTopicId,
        silent,
        parseMode: 'HTML',
      });
      deliveredTopicId = result.message_thread_id ?? null;
    } catch (err: any) {
      if (err instanceof TelegramThreadNotFoundError) {
        const isNamedTopic =
          topicResult.topicName &&
          !topicResult.topicName.startsWith('topic-') &&
          topicResult.topicName !== SYSTEM_TOPICS.GENERAL;

        if (isNamedTopic) {
          console.warn(
            `[Self-Healing] Thread ${err.threadId} for topic "${topicResult.topicName}" was deleted in Telegram. Recreating...`
          );

          // Purge stale KV entry and recreate topic in Telegram
          const healedResult = await recreateTopic(topicResult.topicName, env);
          targetTopicId = healedResult.topicId;

          // Retry sending to the newly created topic
          try {
            result = await sendTelegramMessage(botToken, chatId, formattedText, {
              threadId: targetTopicId,
              silent,
              parseMode: 'HTML',
            });
            deliveredTopicId = result.message_thread_id ?? null;
            if (healedResult.warning) {
              warning = healedResult.warning;
            }
          } catch (retryErr: any) {
            console.warn(
              `[Self-Healing] Delivery to recreated topic failed (${retryErr.message}). Falling back to General...`
            );
            result = await sendTelegramMessage(botToken, chatId, formattedText, {
              silent,
              parseMode: 'HTML',
            });
            deliveredTopicId = null;
            warning = `Topic re-creation succeeded but delivery failed (${retryErr.message}). Delivered to General.`;
          }
        } else {
          // Explicit raw numeric ID was deleted: deliver to General so alert is not dropped
          console.warn(`[Telegram] Thread ${err.threadId} unavailable. Falling back to General...`);
          result = await sendTelegramMessage(botToken, chatId, formattedText, {
            silent,
            parseMode: 'HTML',
          });
          deliveredTopicId = null;
          warning = `Thread ${err.threadId} not found in Telegram. Delivered to General.`;
        }
      } else {
        throw err;
      }
    }

    if (c.req.path === '/send' && c.req.header('accept')?.includes('text/html') && !c.req.header('accept')?.includes('application/json')) {
      return c.html(renderSendPage({ status: 'sent' }));
    }

    return c.json<GatewayResponse>({
      success: true,
      message_id: result.message_id,
      topic: topicResult.topicName,
      topic_id: deliveredTopicId,
      target_topic_id: targetTopicId ?? null,
      delivered_to: deliveredTopicId ? `Topic ${deliveredTopicId}` : 'General',
      is_catchall: payload.is_catchall ?? false,
      silent,
      is_verified: isVerified,
      token_type: authResult.tokenType || null,
      warning,
    });
  } catch (error: any) {
    console.error('[Notification Dispatch Error]', error);

    if (c.req.path === '/send' && c.req.header('accept')?.includes('text/html') && !c.req.header('accept')?.includes('application/json')) {
      return c.html(renderSendPage({ error: error.message || 'Failed to dispatch Telegram notification' }), 502);
    }

    return c.json<GatewayResponse>(
      {
        success: false,
        is_verified: isVerified,
        error: error.message || 'Failed to dispatch Telegram notification',
      },
      502
    );
  }
}

function safeDecodeURIComponent(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

/**
 * Extracts payload from JSON, form data, raw text, query parameters, or URL path.
 * Automatically classifies malformed, custom-path, or unstructured requests into catchall recovery payloads.
 */
async function parseRequestPayload(c: Context<{ Bindings: Env }>, isVerified = false): Promise<AlertPayload> {
  const method = c.req.method;
  const path = c.req.path;

  // Extract query parameters
  const queryObj: Record<string, string> = {};
  const url = new URL(c.req.url);
  url.searchParams.forEach((val, key) => {
    queryObj[key] = val;
  });

  // Check if request was sent to a custom / dynamic subpath (e.g. /notify/message=hello or /notify/hello/world)
  const isSendPath = path === '/send';
  const isCustomPath = path !== '/' && path !== '/notify' && !isSendPath;
  let pathMessage: string | undefined;
  let pathTitle: string | undefined;
  let pathTopic: string | undefined;

  if (isCustomPath) {
    const subpath = path.replace(/^\/notify\/?/, '').replace(/^\//, '');
    if (subpath) {
      if (subpath.includes('=')) {
        // e.g. /notify/message=hello or /notify/title=Alert&message=Hi
        const params = new URLSearchParams(subpath);
        pathMessage = params.get('message') || params.get('m') || params.get('msg') || undefined;
        pathTitle = params.get('title') || params.get('t') || undefined;
        pathTopic = params.get('topic') || params.get('c') || undefined;
        if (!pathMessage) {
          pathMessage = subpath;
        }
      } else if (subpath.includes('/')) {
        // e.g. /notify/hello/world -> title: "hello", message: "world"
        const segments = subpath.split('/').map(safeDecodeURIComponent);
        pathTitle = segments[0];
        pathMessage = segments.slice(1).join(' / ');
      } else if (isVerified) {
        // e.g. /notify/hello (authenticated path shortcut)
        pathMessage = safeDecodeURIComponent(subpath);
      }
    }
  }

  if (method === 'GET') {
    const queryMessage = c.req.query('message');
    const queryShorthandM = c.req.query('m');
    const rawMessage = queryMessage || queryShorthandM || pathMessage;
    const rawTopic = c.req.query('topic') || c.req.query('category') || c.req.query('c') || pathTopic || (isSendPath ? 'inbox' : undefined);
    const rawTitle = c.req.query('title') || c.req.query('t') || pathTitle;

    // 1. If custom subpath was used (e.g. /notify/message=hello or /notify/hello/world),
    // it's a non-standard structural request -> route to catchall!
    if (isCustomPath) {
      return {
        is_catchall: true,
        topic: 'catchall',
        title: rawTitle || 'Catch-All Path Request',
        message: rawMessage || '',
        raw_path: path,
        raw_query: Object.keys(queryObj).length > 0 ? queryObj : undefined,
      };
    }

    // 2. Query parameter evaluation:
    // If query has parameters, check whether it's a clean standard alert or a catch-all
    const hasQuery = Object.keys(queryObj).length > 0;
    const hasStandardMessage = Boolean(queryMessage);

    if (hasQuery) {
      // If request uses shorthand ('m=hello&t=world') or has no standard message field:
      // It's raw HTTP query parameters -> route to catchall!
      if (!hasStandardMessage) {
        return {
          is_catchall: true,
          topic: 'catchall',
          title: rawTitle || 'Catch-All GET Request',
          message: rawMessage || '',
          raw_query: queryObj,
        };
      }
    }

    return {
      message: rawMessage || '',
      title: rawTitle,
      topic: rawTopic,
      silent: parseBoolean(c.req.query('silent')),
      topic_id: c.req.query('topic_id'),
    };
  }

  // POST Handling
  const contentType = c.req.header('content-type') || '';
  const rawBody = await c.req.text();

  if (contentType.includes('application/json')) {
    try {
      const body = JSON.parse(rawBody);

      // Check if body has a message property
      const message = body.message || body.text || body.content;
      if (message && typeof message === 'string' && message.trim() !== '') {
        return {
          message: message.trim(),
          title: body.title || pathTitle,
          topic: body.topic ?? body.category ?? c.req.query('topic') ?? pathTopic ?? (isSendPath ? 'inbox' : undefined),
          silent: parseBoolean(body.silent),
          topic_id: body.topic_id ?? c.req.query('topic_id'),
          raw_path: isCustomPath ? path : undefined,
        };
      }

      // If JSON is empty object ({}) or null, treat as empty payload (SEC-04)
      if (!body || (typeof body === 'object' && Object.keys(body).length === 0)) {
        if (pathMessage) {
          return {
            is_catchall: true,
            topic: 'catchall',
            title: pathTitle || 'Catch-All Path Request',
            message: pathMessage,
            raw_path: path,
            raw_query: Object.keys(queryObj).length > 0 ? queryObj : undefined,
          };
        }
        return {
          message: '',
          topic: isSendPath ? 'inbox' : 'general',
          raw_path: isCustomPath ? path : undefined,
          raw_query: Object.keys(queryObj).length > 0 ? queryObj : undefined,
        };
      }

      // If JSON is valid non-empty but does NOT have a standard message field (e.g. raw third-party webhook):
      // Recover entire JSON in catchall topic!
      return {
        is_catchall: true,
        topic: body.topic ?? 'catchall',
        title: body.title || pathTitle || 'Catch-All JSON Webhook',
        raw_body: rawBody,
        raw_path: isCustomPath ? path : undefined,
        raw_query: Object.keys(queryObj).length > 0 ? queryObj : undefined,
      };
    } catch {
      // If rawBody is empty or whitespace, check if custom path had message
      if (!rawBody || rawBody.trim() === '' || rawBody.trim() === '{}') {
        if (pathMessage) {
          return {
            is_catchall: true,
            topic: 'catchall',
            title: pathTitle || 'Catch-All Path Request',
            message: pathMessage,
            raw_path: path,
            raw_query: Object.keys(queryObj).length > 0 ? queryObj : undefined,
          };
        }
        return {
          message: '',
          topic: isSendPath ? 'inbox' : 'general',
          raw_query: Object.keys(queryObj).length > 0 ? queryObj : undefined,
        };
      }

      // Malformed JSON with actual non-empty content: dump to catchall!
      return {
        is_catchall: true,
        topic: 'catchall',
        title: pathTitle || 'Catch-All Malformed JSON',
        raw_body: rawBody,
        raw_path: isCustomPath ? path : undefined,
        raw_query: Object.keys(queryObj).length > 0 ? queryObj : undefined,
      };
    }
  }

  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    try {
      const formData = await c.req.parseBody();
      const message = String(formData.message || formData.text || '');

      if (message.trim() !== '') {
        return {
          message: message.trim(),
          title: formData.title ? String(formData.title) : pathTitle,
          topic: (formData.topic || formData.category) ? String(formData.topic || formData.category) : (c.req.query('topic') || pathTopic || (isSendPath ? 'inbox' : undefined)),
          silent: parseBoolean(formData.silent),
          topic_id: formData.topic_id ? String(formData.topic_id) : undefined,
          raw_path: isCustomPath ? path : undefined,
        };
      }
    } catch {}
  }

  // Raw body / CLI pipe handling
  if (rawBody && rawBody.trim() !== '') {
    const explicitTopic = c.req.query('topic') || c.req.query('category') || c.req.query('c') || pathTopic || (isSendPath ? 'inbox' : undefined);
    const explicitTitle = c.req.query('title') || c.req.query('t') || pathTitle;

    // If caller specified a topic or title, treat rawBody as the message
    if (explicitTopic || explicitTitle) {
      return {
        message: rawBody.trim(),
        title: explicitTitle,
        topic: explicitTopic,
        silent: parseBoolean(c.req.query('silent')),
        topic_id: c.req.query('topic_id'),
        raw_path: isCustomPath ? path : undefined,
      };
    }

    // Otherwise, treat as catch-all raw payload
    return {
      is_catchall: true,
      topic: 'catchall',
      title: pathTitle || 'Catch-All Raw Body',
      raw_body: rawBody,
      raw_path: isCustomPath ? path : undefined,
      raw_query: Object.keys(queryObj).length > 0 ? queryObj : undefined,
    };
  }

  // If path had message/segments but body was empty:
  if (pathMessage) {
    return {
      is_catchall: true,
      topic: 'catchall',
      title: pathTitle || 'Catch-All Path Request',
      message: pathMessage,
      raw_path: path,
      raw_query: Object.keys(queryObj).length > 0 ? queryObj : undefined,
    };
  }

  return {
    message: '',
    topic: 'general',
    raw_query: Object.keys(queryObj).length > 0 ? queryObj : undefined,
  };
}

function parseBoolean(val: unknown): boolean | undefined {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
  }
  return undefined;
}

// Route handlers
app.get('/send', (c) => {
  if (c.req.query('message') || c.req.query('m')) {
    return handleNotification(c);
  }
  return c.html(renderSendPage());
});
app.post('/send', handleNotification);
app.all('/notify/*', handleNotification);
app.all('/notify', handleNotification);
app.all('/', handleNotification);

export default app;
