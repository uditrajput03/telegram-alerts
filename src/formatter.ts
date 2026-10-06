import { AlertPayload } from './types';
import { SYSTEM_TOPICS } from './config';

export const SEPARATOR = '───────────────';
const SPOILER_THRESHOLD = 500;

/**
 * Escapes HTML special characters to prevent Telegram parse errors
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Detects context-aware priority emoji from title/message keywords
 */
export function detectPriorityEmoji(title?: string, message?: string): string {
  const messageSnippet = message ? message.slice(0, 500) : '';
  const text = `${title || ''} ${messageSnippet}`.toLowerCase();

  if (/\b(error|fail(ed|ure)?|crash(ed)?|critical|fatal|exception|panic|down|broken|outage)\b/.test(text)) return '🔴';
  if (/\b(security|auth|login|breach|vulnerability|unauthorized|forbidden)\b/.test(text)) return '🛡️';
  if (/\b(success(ful)?|resolved|fixed|complete[d]?|passed|healthy|recovered|restored)\b/.test(text)) return '🟢';
  if (/\b(build|deploy(ing|ed)?|release[d]?|ship(ped)?|publish(ed)?|pipeline)\b/.test(text)) return '🚀';
  if (/\b(warn(ing)?|alert|attention|caution|degraded|timeout|slow)\b/.test(text)) return '🟠';
  if (/\b(database|db|sql|migration|backup|restore|replica)\b/.test(text)) return '🗄️';
  if (/\b(payment|invoice|billing|subscription|charge)\b/.test(text)) return '💳';
  if (/\b(test(ing|ed)?|ci|spec|coverage|lint)\b/.test(text)) return '🧪';
  if (/\b(user|signup|registration|onboard)\b/.test(text)) return '👤';
  if (/\b(info|update[d]?|notice|changelog|version)\b/.test(text)) return '🔵';

  return '🔔';
}

/**
 * Converts Markdown syntax (*bold*, _italic_, `code`, ```pre```, [link](url)) to Telegram HTML
 */
export function markdownToTelegramHtml(markdown: string): string {
  if (!markdown) return '';

  const placeholders: string[] = [];
  const makePlaceholder = (content: string) => {
    const idx = placeholders.length;
    placeholders.push(content);
    return `___TG_PLACEHOLDER_${idx}___`;
  };

  let text = markdown;

  // 1. Fenced code blocks
  text = text.replace(/```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g, (_, lang, code) => {
    const escapedCode = escapeHtml(code.trim());
    const langAttr = lang ? ` class="language-${escapeHtml(lang.trim())}"` : '';
    return makePlaceholder(`<pre><code${langAttr}>${escapedCode}</code></pre>`);
  });

  // 2. Inline code
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    return makePlaceholder(`<code>${escapeHtml(code)}</code>`);
  });

  // 3. Escape HTML entities
  text = escapeHtml(text);

  // 4. Mark expandable blockquotes before bold replacement so that `**>` is not treated as unclosed bold
  text = text.replace(/^(\s*)\*\*&gt; ?/gm, '$1___TG_EXP_QUOTE___');
  text = text.replace(/^(\s*)&gt;&gt; ?/gm, '$1___TG_EXP_QUOTE___');
  text = text.replace(/^(\s*)&gt;! ?/gm, '$1___TG_EXP_QUOTE___');

  // 5. Links
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
    return `<a href="${url}">${label}</a>`;
  });

  // 6. Bold
  text = text.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  text = text.replace(/\*([^*\s][^*]*[^*\s]|[^*\s])\*/g, '<b>$1</b>');

  // 7. Italic (lookarounds ensure separating whitespace is not consumed)
  text = text.replace(/(?<=^|\s)_([^_\s][^_]*[^_\s]|[^_\s])_(?=$|\s)/g, '<i>$1</i>');

  // 8. Strikethrough
  text = text.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // 9. Spoilers (||hidden text||)
  text = text.replace(/\|\|([^|]+)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');

  // 10. Blockquotes (Standard and Expandable)
  const lines = text.split('\n');
  const processedLines: string[] = [];
  let inBlockquote = false;
  let quoteBuffer: string[] = [];
  let isExpandableQuote = false;

  for (const line of lines) {
    const isExplicitExpandable = line.startsWith('___TG_EXP_QUOTE___');
    const isStandardQuote = line.startsWith('&gt; ') || line === '&gt;';

    if (isExplicitExpandable || isStandardQuote) {
      inBlockquote = true;
      if (isExplicitExpandable) {
        isExpandableQuote = true;
        quoteBuffer.push(line.replace(/^___TG_EXP_QUOTE___/, ''));
      } else {
        quoteBuffer.push(line.replace(/^&gt; ?/, ''));
      }
    } else {
      if (inBlockquote) {
        const quoteContent = quoteBuffer.join('\n');
        const shouldExpand = isExpandableQuote || quoteContent.length > 250 || quoteBuffer.length > 3;
        const tag = shouldExpand ? '<blockquote expandable>' : '<blockquote>';
        processedLines.push(`${tag}${quoteContent}</blockquote>`);
        quoteBuffer = [];
        inBlockquote = false;
        isExpandableQuote = false;
      }
      processedLines.push(line);
    }
  }
  if (inBlockquote) {
    const quoteContent = quoteBuffer.join('\n');
    const shouldExpand = isExpandableQuote || quoteContent.length > 250 || quoteBuffer.length > 3;
    const tag = shouldExpand ? '<blockquote expandable>' : '<blockquote>';
    processedLines.push(`${tag}${quoteContent}</blockquote>`);
  }
  text = processedLines.join('\n');

  // 9. Restore placeholders safely (use function replacer to prevent special $ pattern interpretation)
  for (let i = 0; i < placeholders.length; i++) {
    text = text.replace(`___TG_PLACEHOLDER_${i}___`, () => placeholders[i]);
  }

  return text;
}

/**
 * Wraps content in <tg-spoiler> if it exceeds the threshold length.
 * Helps keep catch-all recovery messages compact — users tap to reveal large payloads.
 */
function wrapSpoilerIfLarge(content: string, threshold = SPOILER_THRESHOLD): string {
  if (content.length > threshold) {
    return `<tg-spoiler>${content}</tg-spoiler>`;
  }
  return content;
}

/**
 * Truncates an HTML string safely to Telegram's 4096 character limit.
 * Uses a stack to balance all opened tags in reverse (LIFO) order.
 */
export function truncateForTelegram(html: string, maxLen = 4000): string {
  if (html.length <= maxLen) {
    return html;
  }
  const truncationNotice = '\n\n<i>[… Content truncated]</i>';
  const targetLen = maxLen > truncationNotice.length ? maxLen - truncationNotice.length : Math.max(0, maxLen);
  let sliced = html.slice(0, targetLen);

  // Strip trailing incomplete tag or entity
  sliced = sliced.replace(/<[^>]*$/, '');
  sliced = sliced.replace(/&[a-zA-Z0-9#]+$/, '');

  // Balance open tags in LIFO order
  const tagRegex = /<(\/)?([a-zA-Z0-9_-]+)(?:\s+[^>]*)?>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(sliced)) !== null) {
    const isClosing = Boolean(match[1]);
    const tagName = match[2].toLowerCase();

    if (!isClosing) {
      stack.push(tagName);
    } else {
      const idx = stack.lastIndexOf(tagName);
      if (idx !== -1) {
        stack.splice(idx, 1);
      }
    }
  }

  while (stack.length > 0) {
    const tag = stack.pop()!;
    sliced += `</${tag}>`;
  }

  return sliced + truncationNotice;
}

/**
 * Formats Telegram message with clean card-like layout
 */
export function formatTelegramMessage(
  payload: AlertPayload,
  isVerified: boolean,
  options?: { timezone?: string }
): string {
  const parts: string[] = [];
  const timestamp = formatTimestamp(new Date(), options?.timezone);

  // ─── A. Catch-All Structural Recovery Message ───
  if (payload.is_catchall) {
    parts.push('📦 <b>Catch-All Recovery</b>');
    parts.push('<blockquote>Raw or unformatted payload recovered</blockquote>');

    if (payload.raw_path) {
      parts.push(`📍 <b>Path:</b> <code>${escapeHtml(payload.raw_path)}</code>`);
    }

    if (payload.title && payload.title.trim() !== '') {
      parts.push(`📌 <b>${escapeHtml(payload.title.trim())}</b>`);
    }

    if (payload.message && payload.message.trim() !== '') {
      parts.push(`<b>📄 Content</b>\n${markdownToTelegramHtml(payload.message.trim())}`);
    }

    if (payload.raw_query && Object.keys(payload.raw_query).length > 0) {
      const jsonStr = JSON.stringify(payload.raw_query, null, 2);
      const safeQuery = jsonStr.length > 1500 ? jsonStr.slice(0, 1500) + '\n…' : jsonStr;
      const codeBlock = `<pre><code>${escapeHtml(safeQuery)}</code></pre>`;
      parts.push(`<b>📋 Query Params</b>\n${wrapSpoilerIfLarge(codeBlock)}`);
    }

    if (payload.raw_body && payload.raw_body.trim() !== '') {
      const maxRawLen = 3000;
      let rawText = payload.raw_body.trim();
      if (rawText.length > maxRawLen) {
        rawText = rawText.slice(0, maxRawLen) + '\n\n[… truncated]';
      }
      const codeBlock = `<pre><code>${escapeHtml(rawText)}</code></pre>`;
      parts.push(`<b>📦 Raw Body</b>\n${wrapSpoilerIfLarge(codeBlock)}`);
    }

    parts.push(`${SEPARATOR}\n🕒 <i>${timestamp}</i>`);
    return truncateForTelegram(parts.join('\n\n'));
  }

  // ─── B. Standard Message ───
  const isInbox =
    typeof payload.topic === 'string' &&
    (payload.topic.toLowerCase() === 'inbox' || payload.topic.toLowerCase() === SYSTEM_TOPICS.INBOX);
  if (!isVerified && !isInbox) {
    parts.push('<blockquote>🔓 <b>Unverified Source</b></blockquote>');
  }

  const emoji = detectPriorityEmoji(payload.title, payload.message);
  const hasTitle = Boolean(payload.title && payload.title.trim() !== '');
  const messageText = payload.message ? payload.message.trim() : '';

  if (hasTitle) {
    parts.push(`${emoji} <b>${escapeHtml(payload.title!.trim())}</b>`);
  }

  if (messageText) {
    if (!hasTitle) {
      // No title — attach priority emoji directly to the message
      parts.push(`${emoji} ${markdownToTelegramHtml(messageText)}`);
    } else {
      parts.push(markdownToTelegramHtml(messageText));
    }
  }

  // Footer metadata
  const footerItems: string[] = [`🕒 <i>${timestamp}</i>`];
  if (payload.topic) {
    footerItems.push(`🏷️ <code>#${escapeHtml(String(payload.topic))}</code>`);
  }

  parts.push(`${SEPARATOR}\n${footerItems.join('  ·  ')}`);

  return truncateForTelegram(parts.join('\n\n'));
}

const timestampFormatterCache = new Map<string, Intl.DateTimeFormat>();

function formatTimestamp(date: Date, timezone?: string): string {
  try {
    const tz = timezone || 'UTC';
    let formatter = timestampFormatterCache.get(tz);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      timestampFormatterCache.set(tz, formatter);
    }
    return `${formatter.format(date)} ${tz}`;
  } catch {
    return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  }
}
