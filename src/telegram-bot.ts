import { Env, TelegramUpdate, AlertPayload } from './types';
import {
  createStoredToken,
  listStoredTokens,
  revokeStoredToken,
  maskToken,
} from './token-manager';
import { getChatMember, sendTelegramMessage } from './telegram';
import { escapeHtml, SEPARATOR, formatTelegramMessage } from './formatter';
import { muteTopic, unmuteTopic, listMutedTopics } from './mute-manager';
import { resolveTopicId } from './topic-manager';

/**
 * Handles incoming webhook updates from Telegram
 */
export async function handleTelegramWebhook(
  update: TelegramUpdate,
  env: Env,
  gatewayHost: string
): Promise<void> {
  const msg = update.message;
  if (!msg || !msg.text) {
    return;
  }

  const text = msg.text.trim();
  const chatId = msg.chat.id;
  const threadId = msg.message_thread_id;
  const botToken = env.TELEGRAM_BOT_TOKEN;

  if (!botToken) return;

  // Helper to send bot replies back to the same chat and thread
  const reply = async (replyHtml: string) => {
    try {
      await sendTelegramMessage(botToken, chatId, replyHtml, {
        threadId,
        silent: false,
        parseMode: 'HTML',
      });
    } catch (err) {
      console.error('[Bot Reply Error]', err);
    }
  };

  // Strip bot mention if in group: e.g. "/token@MyBot" -> "/token"
  const cleanText = text.replace(/@\w+/g, '');
  const parts = cleanText.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  // 1. Diagnostic / ID command (always open)
  if (command === '/id' || command === '/chatid' || command === '/info') {
    const threadDisplay = threadId ? `<code>${threadId}</code>` : '<i>General (no thread)</i>';
    const userDisplay = msg.from.username
      ? `@${escapeHtml(msg.from.username)}`
      : escapeHtml(msg.from.first_name || 'User');

    const replyText = [
      'ℹ️ <b>Chat Diagnostic Info</b>',
      SEPARATOR,
      `  <b>Chat ID:</b>  <code>${chatId}</code>`,
      `  <b>Chat Type:</b>  <code>${msg.chat.type}</code>`,
      `  <b>Topic ID:</b>  ${threadDisplay}`,
      `  <b>User ID:</b>  <code>${msg.from.id}</code> (${userDisplay})`,
      SEPARATOR,
      '💡 <i>Set <code>TELEGRAM_CHAT_ID</code> in Cloudflare secrets.</i>',
    ].join('\n');
    await reply(replyText);
    return;
  }

  // 2. Start / Help
  if (command === '/start' || command === '/help') {
    const helpText = [
      '🤖 <b>Notification Gateway</b>',
      SEPARATOR,
      '',
      '<b>🗂️ Topics &amp; Muting</b>',
      '  · <code>/settopic &lt;name&gt;</code> — Bind topic',
      '  · <code>/topics</code> — List mappings',
      '  · <code>/mute [topic] [1h|24h]</code> — Silence topic',
      '  · <code>/unmute &lt;topic&gt;</code> — Resume sound',
      '  · <code>/test [topic]</code> — Test alert delivery',
      '  · <code>/status</code> — Gateway health &amp; stats',
      '  · <code>/id</code> — Chat &amp; topic info',
      '',
      '<b>🔑 Tokens</b>',
      '  · <code>/token ephemeral [1h|24h|7d]</code> — Temp token',
      '  · <code>/token permanent [label]</code> — Permanent token',
      '  · <code>/tokens</code> — List all tokens',
      '  · <code>/revoke &lt;token&gt;</code> — Revoke a token',
      '',
      SEPARATOR,
      '💡 <code>/help</code> — Show this menu',
    ].join('\n');
    await reply(helpText);
    return;
  }

  // 3. Authorization check for management commands
  if (
    command === '/token' ||
    command === '/tokens' ||
    command === '/revoke' ||
    command === '/settopic' ||
    command === '/mute' ||
    command === '/unmute' ||
    command === '/test' ||
    command === '/status'
  ) {
    const authorized = await isAuthorizedUser(env, msg);
    if (!authorized) {
      await reply('⛔ <b>Access Denied:</b> You are not authorized to manage tokens or topics on this gateway.');
      return;
    }
  }

  // 4. Token generation & management commands
  if (command === '/token') {
    const subAction = (args[0] || '').toLowerCase();

    if (subAction === 'ephemeral' || subAction === 'temp') {
      // Syntax: /token ephemeral [duration, e.g. 2h] [label]
      let durationStr = '24h';
      let label = 'ephemeral';

      if (args[1]) {
        // If args[1] looks like duration (e.g. 1h, 30m, 7d)
        if (args[1].match(/^\d+(m|min|h|hr|d|day)?$/i)) {
          durationStr = args[1];
          label = args.slice(2).join(' ') || 'ephemeral';
        } else {
          label = args.slice(1).join(' ');
        }
      }

      try {
        const { token, durationHuman } = await createStoredToken(env, {
          type: 'ephemeral',
          duration: durationStr,
          label,
          createdBy: msg.from.username || String(msg.from.id),
        });

        const replyHtml = [
          '🎟️ <b>Ephemeral Token Generated</b>',
          SEPARATOR,
          '',
          `<code>${token.token}</code> <i>(tap to copy)</i>`,
          '',
          `  ⏱️ <b>Expires In:</b>  ${durationHuman}`,
          `  📅 <b>Expires At:</b>  <i>${new Date(token.expiresAt!).toUTCString()}</i>`,
          `  🏷️ <b>Label:</b>  <code>${token.label}</code>`,
          '',
          SEPARATOR,
          '<b>Quick Usage:</b>',
          `<code>curl -X POST "https://${gatewayHost}/notify" \\`,
          `  -H "x-api-key: ${token.token}" \\`,
          `  -d '{"message": "Hello from ephemeral token", "category": "dev"}'</code>`,
        ].join('\n');

        await reply(replyHtml);
      } catch (err: any) {
        await reply(`❌ <b>Failed to generate ephemeral token:</b> ${err.message}`);
      }
      return;
    }

    if (subAction === 'permanent' || subAction === 'perm') {
      const label = args.slice(1).join(' ') || 'permanent';

      try {
        const { token } = await createStoredToken(env, {
          type: 'permanent',
          label,
          createdBy: msg.from.username || String(msg.from.id),
        });

        const replyHtml = [
          '🔑 <b>Permanent Token Generated</b>',
          SEPARATOR,
          '',
          `<code>${token.token}</code> <i>(tap to copy)</i>`,
          '',
          `  🏷️ <b>Label:</b>  <code>${token.label}</code>`,
          `  🗑️ <b>Revoke:</b>  <code>/revoke ${token.token}</code>`,
          '',
          '<blockquote>⚠️ Store this token securely.</blockquote>',
          '',
          SEPARATOR,
          '<b>Quick Usage:</b>',
          `<code>curl -X POST "https://${gatewayHost}/notify" \\`,
          `  -H "x-api-key: ${token.token}" \\`,
          `  -d '{"message": "Hello from permanent token", "category": "dev"}'</code>`,
        ].join('\n');

        await reply(replyHtml);
      } catch (err: any) {
        await reply(`❌ <b>Failed to generate permanent token:</b> ${err.message}`);
      }
      return;
    }

    // Default /token usage prompt
    await reply(
      '💡 <b>Token Usage:</b>\n' +
      SEPARATOR + '\n' +
      '  · <code>/token ephemeral [1h|24h|7d] [label]</code>\n' +
      '  · <code>/token permanent [label]</code>\n' +
      '  · <code>/tokens</code> — List all tokens'
    );
    return;
  }

  // 5. List active tokens
  if (command === '/tokens') {
    try {
      const tokens = await listStoredTokens(env);
      if (tokens.length === 0) {
        await reply('📋 <b>No active bot tokens found in KV.</b>\n<i>(Static env.AUTH_TOKEN is still active if configured).</i>');
        return;
      }

      const lines = [
        `📋 <b>Active Tokens (${tokens.length})</b>`,
        SEPARATOR,
        '',
      ];

      tokens.forEach((t, i) => {
        const typeBadge = t.type === 'permanent' ? '🔑 Permanent' : '🎟️ Ephemeral';
        let expiryInfo = '';
        if (t.type === 'ephemeral' && t.expiresAt) {
          const diffMin = Math.round((t.expiresAt - Date.now()) / (1000 * 60));
          expiryInfo = diffMin > 60
            ? `\n   ⏱️ Expires: ~${Math.round(diffMin / 60)}h`
            : `\n   ⏱️ Expires: ~${diffMin}m`;
        }

        lines.push(
          `${i + 1}. <code>${maskToken(t.token)}</code>  [${typeBadge}]` +
          `\n   🏷️ <code>${t.label}</code>  ·  👤 <i>${t.createdBy}</i>` +
          expiryInfo +
          `\n   🗑️ <code>/revoke ${t.token}</code>\n`
        );
      });

      await reply(lines.join('\n'));
    } catch (err: any) {
      await reply(`❌ <b>Failed to list tokens:</b> ${err.message}`);
    }
    return;
  }

  // 6. Revoke token
  if (command === '/revoke') {
    const tokenToRevoke = args[0];
    if (!tokenToRevoke) {
      await reply('Usage: <code>/revoke &lt;token&gt;</code>');
      return;
    }

    try {
      const revoked = await revokeStoredToken(tokenToRevoke.trim(), env);
      if (revoked) {
        await reply(`✅ <b>Token revoked:</b> <code>${maskToken(tokenToRevoke)}</code>`);
      } else {
        await reply(`⚠️ Token not found or already revoked: <code>${maskToken(tokenToRevoke)}</code>`);
      }
    } catch (err: any) {
      await reply(`❌ <b>Failed to revoke token:</b> ${err.message}`);
    }
    return;
  }

  // 7. Bind current topic to a topic name (/settopic <topic>)
  if (command === '/settopic') {
    if (!threadId) {
      await reply(
        '⚠️ <b>Cannot map General chat:</b>\n' +
        'Please run <code>/settopic &lt;name&gt;</code> inside a specific Forum Topic (not in General).'
      );
      return;
    }

    const rawTopicName = args[0];
    if (!rawTopicName) {
      await reply('Usage: <code>/settopic &lt;name&gt;</code> (e.g. <code>/settopic alerts</code>, <code>/settopic deploy</code>)');
      return;
    }

    const topicName = rawTopicName.trim().toLowerCase();

    if (!env.GATEWAY_KV) {
      await reply('⚠️ <b>Cloudflare KV is not bound:</b> Please bind <code>GATEWAY_KV</code> in <code>wrangler.toml</code> to persist topic mappings.');
      return;
    }

    try {
      await env.GATEWAY_KV.put(`topic:${topicName}`, String(threadId));

      // Update topic index in KV
      const indexKey = 'topics:index';
      const existingRaw = await env.GATEWAY_KV.get(indexKey, 'json');
      const index: Record<string, number> = (existingRaw && typeof existingRaw === 'object') ? (existingRaw as any) : {};
      index[topicName] = threadId;
      await env.GATEWAY_KV.put(indexKey, JSON.stringify(index));

      await reply(
        `✅ <b>Topic Bound!</b>\n` +
        SEPARATOR + `\n` +
        `  <b>Name:</b>  <code>${topicName}</code>\n` +
        `  <b>Thread ID:</b>  <code>${threadId}</code>\n` +
        SEPARATOR + `\n` +
        `Alerts with <code>"topic": "${topicName}"</code> will route here.`
      );
    } catch (err: any) {
      await reply(`❌ <b>Failed to save topic mapping:</b> ${err.message}`);
    }
    return;
  }

  // 8. List all mapped topics (/topics)
  if (command === '/topics') {
    if (!env.GATEWAY_KV) {
      await reply('⚠️ Cloudflare KV is not bound. Predefined topics are configured via wrangler.toml.');
      return;
    }

    try {
      const existingRaw = await env.GATEWAY_KV.get('topics:index', 'json');
      const index: Record<string, number> = (existingRaw && typeof existingRaw === 'object') ? (existingRaw as any) : {};
      const entries = Object.entries(index);

      if (entries.length === 0) {
        await reply(
          '📋 <b>No dynamically mapped topics yet.</b>\n\n' +
          'To map a topic, open any topic in this group and type:\n' +
          '<code>/settopic &lt;name&gt;</code> (e.g. <code>/settopic deploy</code>)'
        );
        return;
      }

      const lines = [
        '📋 <b>Active Topic Mappings</b>',
        SEPARATOR,
        '',
      ];
      for (const [topic, id] of entries) {
        lines.push(`  · <code>${topic}</code>  ➔  Topic ID <code>${id}</code>`);
      }
      lines.push('', SEPARATOR);
      await reply(lines.join('\n'));
    } catch (err: any) {
      await reply(`❌ <b>Failed to list topics:</b> ${err.message}`);
    }
    return;
  }

  // Helper to resolve topic name from current threadId
  const getTopicNameForCurrentThread = async (): Promise<string | undefined> => {
    if (!threadId || !env.GATEWAY_KV) return undefined;
    try {
      const raw = await env.GATEWAY_KV.get('topics:index', 'json');
      if (raw && typeof raw === 'object') {
        for (const [name, id] of Object.entries(raw as Record<string, number>)) {
          if (id === threadId) return name;
        }
      }
    } catch {}
    return `topic-${threadId}`;
  };

  // 9. Mute topic (/mute [topic] [duration])
  if (command === '/mute') {
    if (!env.GATEWAY_KV) {
      await reply('⚠️ Cloudflare KV is not bound. KV is required to store topic mute state.');
      return;
    }

    let targetTopic: string | undefined;
    let durationStr: string | undefined;

    if (args.length === 0) {
      if (threadId) {
        targetTopic = await getTopicNameForCurrentThread();
        durationStr = '24h';
      } else {
        const activeMutes = await listMutedTopics(env);
        if (activeMutes.length === 0) {
          await reply(
            '🔕 <b>No active topic mutes.</b>\n\n' +
            SEPARATOR + '\n' +
            '<b>Usage:</b>\n' +
            '  · <code>/mute &lt;topic&gt; [1h|4h|24h|7d]</code>\n' +
            '  · <code>/unmute &lt;topic&gt;</code>\n\n' +
            '<i>Tip: Inside any topic thread, type <code>/mute 2h</code> to mute that topic directly.</i>'
          );
          return;
        }

        const lines = [
          `🔕 <b>Active Topic Mutes (${activeMutes.length})</b>`,
          SEPARATOR,
          '',
        ];
        for (const m of activeMutes) {
          const diffMinutes = Math.max(0, Math.round((m.mutedUntil - Date.now()) / (1000 * 60)));
          const remaining = diffMinutes > 60 ? `~${Math.round(diffMinutes / 60)}h` : `~${diffMinutes}m`;
          lines.push(`  · <code>#${escapeHtml(m.topic)}</code> — muted for ${remaining} (by <i>${escapeHtml(m.mutedBy)}</i>)`);
        }
        lines.push('', SEPARATOR);
        lines.push('💡 <i>Use <code>/unmute &lt;topic&gt;</code> to unmute early.</i>');
        await reply(lines.join('\n'));
        return;
      }
    } else if (args.length === 1) {
      const arg = args[0];
      if (arg.match(/^\d+(m|min|h|hr|d|day|days)?$/i) && threadId) {
        targetTopic = await getTopicNameForCurrentThread();
        durationStr = arg;
      } else {
        targetTopic = arg;
        durationStr = '24h';
      }
    } else {
      targetTopic = args[0];
      durationStr = args[1];
    }

    if (!targetTopic) {
      await reply('Usage: <code>/mute &lt;topic&gt; [duration, e.g. 2h, 24h]</code>');
      return;
    }

    try {
      const sender = msg.from.username || String(msg.from.id);
      const { topic, durationHuman, expiresAt } = await muteTopic(targetTopic, durationStr, sender, env);
      const expiryDate = new Date(expiresAt).toUTCString();

      const replyHtml = [
        '🔕 <b>Topic Muted</b>',
        SEPARATOR,
        `  <b>Topic:</b>  <code>#${escapeHtml(topic)}</code>`,
        `  <b>Duration:</b>  ${durationHuman}`,
        `  <b>Muted Until:</b>  <i>${expiryDate}</i>`,
        SEPARATOR,
        'Alerts routed to this topic will be delivered silently.',
        `💡 <i>To unmute early: <code>/unmute ${escapeHtml(topic)}</code></i>`,
      ].join('\n');

      await reply(replyHtml);
    } catch (err: any) {
      await reply(`❌ <b>Failed to mute topic:</b> ${escapeHtml(err.message)}`);
    }
    return;
  }

  // 10. Unmute topic (/unmute [topic])
  if (command === '/unmute') {
    if (!env.GATEWAY_KV) {
      await reply('⚠️ Cloudflare KV is not bound.');
      return;
    }

    let targetTopic: string | undefined = args[0];
    if (!targetTopic && threadId) {
      targetTopic = await getTopicNameForCurrentThread();
    }

    if (!targetTopic) {
      await reply('Usage: <code>/unmute &lt;topic&gt;</code>');
      return;
    }

    try {
      const unmuted = await unmuteTopic(targetTopic, env);
      if (unmuted) {
        await reply(`🔔 <b>Topic Unmuted:</b> Alerts for <code>#${escapeHtml(targetTopic.toLowerCase())}</code> will now notify with sound.`);
      } else {
        await reply(`⚠️ Topic <code>#${escapeHtml(targetTopic.toLowerCase())}</code> was not actively muted.`);
      }
    } catch (err: any) {
      await reply(`❌ <b>Failed to unmute topic:</b> ${escapeHtml(err.message)}`);
    }
    return;
  }

  // 11. Test alert dispatch (/test [topic])
  if (command === '/test') {
    let targetTopic: string | undefined = args[0];
    if (!targetTopic && threadId) {
      targetTopic = await getTopicNameForCurrentThread();
    }

    if (!targetTopic) {
      targetTopic = 'general';
    }

    try {
      const sender = msg.from.username ? `@${escapeHtml(msg.from.username)}` : escapeHtml(msg.from.first_name || 'Admin');
      const testPayload: AlertPayload = {
        title: 'Gateway Test Ping',
        message: `End-to-end delivery test initiated by ${sender}.\nTopic mapping and Telegram connection verified.`,
        topic: targetTopic === 'general' ? undefined : targetTopic,
      };

      const topicResult = await resolveTopicId(testPayload, true, env);
      const formattedText = formatTelegramMessage(testPayload, true, { timezone: env.TIMEZONE });

      const testResult = await sendTelegramMessage(botToken, chatId, formattedText, {
        threadId: topicResult.topicId,
        silent: false,
        parseMode: 'HTML',
      });

      const replyHtml = [
        '✅ <b>Test Notification Dispatched</b>',
        SEPARATOR,
        `  <b>Target Topic:</b>  <code>${escapeHtml(topicResult.topicName)}</code>`,
        `  <b>Thread ID:</b>  <code>${topicResult.topicId ?? 'General'}</code>`,
        `  <b>Message ID:</b>  <code>${testResult.message_id}</code>`,
        SEPARATOR,
        'Delivery succeeded.',
      ].join('\n');

      await reply(replyHtml);
    } catch (err: any) {
      await reply(`❌ <b>Test failed:</b> ${escapeHtml(err.message)}`);
    }
    return;
  }

  // 12. Gateway Status (/status, /health)
  if (command === '/status' || command === '/health') {
    let topicCount = 0;
    if (env.GATEWAY_KV) {
      try {
        const idx = await env.GATEWAY_KV.get('topics:index', 'json');
        if (idx && typeof idx === 'object') {
          topicCount = Object.keys(idx).length;
        }
      } catch {}
    }

    const tokens = await listStoredTokens(env);
    const mutes = await listMutedTopics(env);

    let quietStatus = 'Disabled';
    if (env.QUIET_HOURS_START !== undefined && env.QUIET_HOURS_END !== undefined && env.QUIET_HOURS_START !== '') {
      quietStatus = `${env.QUIET_HOURS_START}:00 - ${env.QUIET_HOURS_END}:00 (${env.TIMEZONE || 'UTC'})`;
    }

    const replyHtml = [
      '📊 <b>Gateway System Status</b>',
      SEPARATOR,
      '  🟢 <b>Status:</b>  Operational',
      `  🗂️ <b>Mapped Topics:</b>  <code>${topicCount}</code>`,
      `  🔑 <b>Active Bot Tokens:</b>  <code>${tokens.length}</code>`,
      `  🔕 <b>Muted Topics:</b>  <code>${mutes.length}</code>`,
      `  🌙 <b>Quiet Hours:</b>  ${quietStatus}`,
      SEPARATOR,
      `  <b>Chat ID:</b>  <code>${chatId}</code>`,
    ].join('\n');

    await reply(replyHtml);
    return;
  }
}

/**
 * Strictly verifies if the message sender has permission to manage tokens.
 *
 * Rules:
 * 1. If `ADMIN_USER_ID` is set, ONLY users in that list can manage the bot (highest security).
 * 2. If not set, the sender MUST be an Administrator or Creator of the designated `TELEGRAM_CHAT_ID`.
 * 3. Strangers, non-admins, and third-party groups are strictly rejected.
 */
async function isAuthorizedUser(
  env: Env,
  msg: NonNullable<TelegramUpdate['message']>
): Promise<boolean> {
  const senderId = String(msg.from.id);
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const configuredChatId = env.TELEGRAM_CHAT_ID;

  // 1. If explicit ADMIN_USER_ID is configured, strictly enforce it (supports comma-separated IDs)
  if (env.ADMIN_USER_ID && env.ADMIN_USER_ID.trim()) {
    const adminIds = env.ADMIN_USER_ID.split(',').map((id) => id.trim());
    return adminIds.includes(senderId);
  }

  // 2. If no ADMIN_USER_ID is set, we strictly require a configured group chat ID and bot token
  if (!configuredChatId || !botToken) {
    console.warn('[Security] No ADMIN_USER_ID or TELEGRAM_CHAT_ID configured. Denying bot management.');
    return false;
  }

  // 3. Must be either inside the designated group OR a private 1-on-1 DM with the bot
  const isFromDesignatedChat = String(msg.chat.id) === String(configuredChatId);
  const isPrivateDm = msg.chat.type === 'private';

  if (!isFromDesignatedChat && !isPrivateDm) {
    // Request came from an unknown group or channel
    return false;
  }

  // 4. In both designated group and DM, sender MUST be an Administrator or Creator of the designated chat
  const member = await getChatMember(botToken, configuredChatId, msg.from.id);
  if (member && (member.status === 'creator' || member.status === 'administrator')) {
    return true;
  }

  return false;
}
