import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  markdownToTelegramHtml,
  formatTelegramMessage,
  truncateForTelegram,
  detectPriorityEmoji,
  SEPARATOR,
} from '../src/formatter';

describe('Message Formatter', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")&</script>')).toBe(
      '&lt;script&gt;alert("xss")&amp;&lt;/script&gt;'
    );
  });

  it('converts markdown syntax to Telegram HTML', () => {
    const md = 'Hello **world** and *bold* with _italic_ and `inline_code`';
    const html = markdownToTelegramHtml(md);
    expect(html).toContain('<b>world</b>');
    expect(html).toContain('<b>bold</b>');
    expect(html).toContain('<i>italic</i>');
    expect(html).toContain('<code>inline_code</code>');
  });

  it('safely handles fenced code blocks with language', () => {
    const md = '```typescript\nconst a = 1 < 2;\n```';
    const html = markdownToTelegramHtml(md);
    expect(html).toContain('<pre><code class="language-typescript">const a = 1 &lt; 2;</code></pre>');
  });

  it('converts markdown links to HTML anchors', () => {
    const md = 'Check [Google](https://google.com) here';
    const html = markdownToTelegramHtml(md);
    expect(html).toBe('Check <a href="https://google.com">Google</a> here');
  });

  it('converts spoiler syntax to tg-spoiler', () => {
    const md = 'Secret token: ||super-secret-key||';
    const html = markdownToTelegramHtml(md);
    expect(html).toBe('Secret token: <tg-spoiler>super-secret-key</tg-spoiler>');
  });

  describe('detectPriorityEmoji', () => {
    it('returns red for errors', () => {
      expect(detectPriorityEmoji('Server Error', '')).toBe('🔴');
      expect(detectPriorityEmoji('', 'build failed')).toBe('🔴');
      expect(detectPriorityEmoji('Critical Outage', '')).toBe('🔴');
    });

    it('returns orange for warnings', () => {
      expect(detectPriorityEmoji('Warning: high memory', '')).toBe('🟠');
      expect(detectPriorityEmoji('', 'request timeout detected')).toBe('🟠');
    });

    it('returns green for success', () => {
      expect(detectPriorityEmoji('Deployment Successful', '')).toBe('🟢');
      expect(detectPriorityEmoji('', 'issue resolved')).toBe('🟢');
    });

    it('returns rocket for deploys', () => {
      expect(detectPriorityEmoji('Build Pipeline', '')).toBe('🚀');
      expect(detectPriorityEmoji('', 'deployed to production')).toBe('🚀');
    });

    it('returns shield for security', () => {
      expect(detectPriorityEmoji('Security Alert', '')).toBe('🛡️');
      expect(detectPriorityEmoji('', 'unauthorized access attempt')).toBe('🛡️');
    });

    it('returns database icon for db events', () => {
      expect(detectPriorityEmoji('Database Migration', '')).toBe('🗄️');
    });

    it('returns bell for generic messages', () => {
      expect(detectPriorityEmoji('Hello World', '')).toBe('🔔');
      expect(detectPriorityEmoji('', 'something happened')).toBe('🔔');
    });
  });

  it('formats unverified message with blockquote badge', () => {
    const result = formatTelegramMessage(
      {
        message: 'Disk space at 95%',
        topic: 'infra',
      },
      false // isVerified = false
    );

    expect(result).toContain('<blockquote>🔓 <b>Unverified Source</b></blockquote>');
    expect(result).toContain('Disk space at 95%');
    expect(result).toContain('#infra');
    expect(result).toContain(SEPARATOR);
  });

  it('formats verified message with priority emoji and separator', () => {
    const result = formatTelegramMessage(
      {
        title: 'Server Error',
        message: 'Connection pool exhausted',
        topic: 'database',
      },
      true
    );

    expect(result).toContain('🔴'); // error priority
    expect(result).toContain('<b>Server Error</b>');
    expect(result).toContain('Connection pool exhausted');
    expect(result).toContain('#database');
    expect(result).toContain(SEPARATOR);
    expect(result).not.toContain('Unverified');
  });

  it('formats message without title with emoji prefix on message', () => {
    const result = formatTelegramMessage(
      {
        message: 'Deployment successful',
      },
      true
    );

    expect(result).toContain('🟢'); // success priority
    expect(result).toContain('Deployment successful');
  });

  it('formats catchall raw payload recovery with new layout', () => {
    const result = formatTelegramMessage(
      {
        is_catchall: true,
        topic: 'catchall',
        raw_body: '{"unrecognized": "event", "data": 123}',
        raw_query: { ref: 'github_hook' },
      },
      true
    );

    expect(result).toContain('Catch-All Recovery');
    expect(result).toContain('github_hook');
    expect(result).toContain('unrecognized');
    expect(result).toContain(SEPARATOR);
    expect(result).toContain('<blockquote>');
  });

  it('wraps large raw bodies in tg-spoiler', () => {
    const largeBody = '{"key": "' + 'x'.repeat(600) + '"}';
    const result = formatTelegramMessage(
      {
        is_catchall: true,
        topic: 'catchall',
        raw_body: largeBody,
      },
      true
    );

    expect(result).toContain('<tg-spoiler>');
    expect(result).toContain('</tg-spoiler>');
  });

  it('does not wrap small raw bodies in tg-spoiler', () => {
    const result = formatTelegramMessage(
      {
        is_catchall: true,
        topic: 'catchall',
        raw_body: '{"small": true}',
      },
      true
    );

    expect(result).not.toContain('<tg-spoiler>');
  });

  it('truncates messages exceeding maximum length safely', () => {
    const longText = 'A'.repeat(5000);
    const truncated = truncateForTelegram(longText, 4000);
    expect(truncated.length).toBeLessThanOrEqual(4100); // Allow room for closing tags
    expect(truncated).toContain('[… Content truncated]');
  });

  it('closes tg-spoiler tags when truncating', () => {
    const html = '<tg-spoiler>' + 'A'.repeat(5000) + '</tg-spoiler>';
    const truncated = truncateForTelegram(html, 4000);
    expect(truncated).toContain('</tg-spoiler>');
  });

  it('formats consecutive italic words without consuming spaces', () => {
    const md = 'Check _one_ _two_ _three_ words';
    const html = markdownToTelegramHtml(md);
    expect(html).toBe('Check <i>one</i> <i>two</i> <i>three</i> words');
  });

  it('safely closes unclosed anchor tags on truncation', () => {
    const html = '<a href="https://example.com">' + 'LinkText'.repeat(1000) + '</a>';
    const truncated = truncateForTelegram(html, 500);
    expect(truncated).toContain('</a>');
    expect(truncated).toContain('[… Content truncated]');
  });

  it('balances nested tags in reverse LIFO order on truncation', () => {
    const html = '<b><i><u>' + 'Nested'.repeat(1000) + '</u></i></b>';
    const truncated = truncateForTelegram(html, 500);
    expect(truncated).toContain('</u></i></b>');
  });

  it('strips partially severed opening tags and entities during truncation', () => {
    const html = 'Safe prefix <tg-spoiler>' + 'X'.repeat(500);
    const truncated = truncateForTelegram(html, 20); // Cuts into or before tag
    expect(truncated).not.toContain('<tg-sp');
    expect(truncated).toContain('[… Content truncated]');
  });

  describe('expandable blockquotes', () => {
    it('converts short quotes to standard blockquote', () => {
      const md = '> Line 1\n> Line 2';
      const html = markdownToTelegramHtml(md);
      expect(html).toBe('<blockquote>Line 1\nLine 2</blockquote>');
      expect(html).not.toContain('expandable');
    });

    it('converts explicit **> to expandable blockquote', () => {
      const md = '**> This is an expandable quote';
      const html = markdownToTelegramHtml(md);
      expect(html).toBe('<blockquote expandable>This is an expandable quote</blockquote>');
    });

    it('converts explicit >> to expandable blockquote', () => {
      const md = '>> Another expandable quote';
      const html = markdownToTelegramHtml(md);
      expect(html).toBe('<blockquote expandable>Another expandable quote</blockquote>');
    });

    it('converts explicit >! to expandable blockquote', () => {
      const md = '>! Spoiler expandable quote';
      const html = markdownToTelegramHtml(md);
      expect(html).toBe('<blockquote expandable>Spoiler expandable quote</blockquote>');
    });

    it('automatically converts blockquotes with more than 3 lines to expandable', () => {
      const md = '> Line 1\n> Line 2\n> Line 3\n> Line 4';
      const html = markdownToTelegramHtml(md);
      expect(html).toBe('<blockquote expandable>Line 1\nLine 2\nLine 3\nLine 4</blockquote>');
    });

    it('automatically converts long blockquotes (>250 chars) to expandable', () => {
      const longQuote = '> ' + 'A'.repeat(300);
      const html = markdownToTelegramHtml(longQuote);
      expect(html).toContain('<blockquote expandable>');
      expect(html).toContain('</blockquote>');
    });

    it('safely closes unclosed <blockquote expandable> on truncation', () => {
      const html = '<blockquote expandable>' + 'B'.repeat(5000) + '</blockquote>';
      const truncated = truncateForTelegram(html, 4000);
      expect(truncated).toContain('</blockquote>');
    });
  });
});
