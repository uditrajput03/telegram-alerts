export interface SendPageOptions {
  status?: string;
  error?: string;
}

/**
 * Renders a clean, minimalist black and white HTML page for sending messages to the inbox topic
 */
export function renderSendPage(options?: SendPageOptions): string {
  const isSent = options?.status === 'sent';
  const errorMessage = options?.error ? escapeHtml(options.error) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Send to Inbox</title>
  <style>
    :root {
      --bg: #ffffff;
      --fg: #000000;
      --muted: #737373;
      --border: #000000;
      --line: #e5e5e5;
      --btn-bg: #000000;
      --btn-fg: #ffffff;
      --btn-hover: #262626;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #000000;
        --fg: #ffffff;
        --muted: #8c8c8c;
        --border: #ffffff;
        --line: #262626;
        --btn-bg: #ffffff;
        --btn-fg: #000000;
        --btn-hover: #d9d9d9;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .box {
      width: 100%;
      max-width: 460px;
      border: 1px solid var(--border);
      padding: 1.5rem;
    }
    .header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 1.25rem;
    }
    h1 {
      font-size: 1.125rem;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .topic {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8125rem;
      color: var(--muted);
    }
    textarea {
      width: 100%;
      min-height: 120px;
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--line);
      padding: 0.75rem;
      font-family: inherit;
      font-size: 0.9375rem;
      line-height: 1.5;
      resize: vertical;
      outline: none;
    }
    textarea:focus, input:focus {
      border-color: var(--border);
    }
    .row {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
    input[type="text"], input[type="password"] {
      flex: 1;
      min-width: 0;
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--line);
      padding: 0.5rem 0.625rem;
      font-family: inherit;
      font-size: 0.8125rem;
      outline: none;
    }
    button {
      width: 100%;
      margin-top: 0.75rem;
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: 1px solid var(--btn-bg);
      padding: 0.625rem;
      font-family: inherit;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover:not(:disabled) {
      background: var(--btn-hover);
      border-color: var(--btn-hover);
    }
    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .status {
      margin-top: 0.625rem;
      font-size: 0.8125rem;
      text-align: center;
      min-height: 1.25rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--fg);
    }
    .status.error {
      font-weight: 600;
    }
    .hint {
      margin-top: 0.25rem;
      font-size: 0.6875rem;
      color: var(--muted);
      text-align: center;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
  </style>
</head>
<body>
  <div class="box">
    <div class="header">
      <h1>Send Message</h1>
      <span class="topic">#inbox</span>
    </div>
    <form id="sendForm" method="POST" action="/send">
      <textarea id="message" name="message" placeholder="Write a note..." required autofocus></textarea>
      <div class="row">
        <input type="text" id="title" name="title" placeholder="Title (optional)">
        <input type="password" id="token" name="token" placeholder="Token (optional)">
      </div>
      <input type="hidden" name="topic" value="inbox">
      <button type="submit" id="submitBtn">Send to #inbox</button>
      <div id="status" class="status${isSent ? ' success' : errorMessage ? ' error' : ''}">${isSent ? 'Sent to #inbox!' : errorMessage}</div>
      <p class="hint">Cmd+Enter to send</p>
    </form>
  </div>
  <script>
    const form = document.getElementById('sendForm');
    const msgInput = document.getElementById('message');
    const titleInput = document.getElementById('title');
    const tokenInput = document.getElementById('token');
    const submitBtn = document.getElementById('submitBtn');
    const statusDiv = document.getElementById('status');

    // Restore token from query string or localStorage
    const urlToken = new URLSearchParams(window.location.search).get('token');
    if (urlToken) {
      tokenInput.value = urlToken;
      try { localStorage.setItem('tg_token', urlToken); } catch (_) {}
    } else {
      try {
        const saved = localStorage.getItem('tg_token');
        if (saved) tokenInput.value = saved;
      } catch (_) {}
    }

    // Keyboard shortcut (Cmd+Enter or Ctrl+Enter)
    [msgInput, titleInput, tokenInput].forEach((el) => {
      el.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          form.requestSubmit();
        }
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const message = msgInput.value.trim();
      if (!message) return;

      const title = titleInput.value.trim() || undefined;
      const token = tokenInput.value.trim() || undefined;

      if (token) {
        try { localStorage.setItem('tg_token', token); } catch (_) {}
      }

      submitBtn.disabled = true;
      statusDiv.className = 'status';
      statusDiv.textContent = 'Sending...';

      try {
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
          headers['x-api-key'] = token;
        }

        const res = await fetch('/send', {
          method: 'POST',
          headers,
          body: JSON.stringify({ message, title, topic: 'inbox' })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          statusDiv.className = 'status success';
          statusDiv.textContent = 'Sent to #inbox!';
          msgInput.value = '';
          titleInput.value = '';
          msgInput.focus();
        } else {
          statusDiv.className = 'status error';
          statusDiv.textContent = data.error || 'Failed to send';
        }
      } catch (err) {
        statusDiv.className = 'status error';
        statusDiv.textContent = err.message || 'Network error';
      } finally {
        submitBtn.disabled = false;
        setTimeout(() => {
          if (statusDiv.classList.contains('success')) {
            statusDiv.textContent = '';
          }
        }, 3000);
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
