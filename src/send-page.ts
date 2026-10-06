export interface SendPageOptions {
  status?: string;
  error?: string;
}

/**
 * Renders a minimal, self-contained HTML page for sending messages to the inbox topic
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
      --bg: #0f172a;
      --card: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0ea5e9;
      --success: #4ade80;
      --error: #f87171;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f8fafc;
        --card: #ffffff;
        --border: #e2e8f0;
        --text: #0f172a;
        --text-muted: #64748b;
        --primary: #0284c7;
        --primary-hover: #0369a1;
        --success: #16a34a;
        --error: #dc2626;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .card {
      width: 100%;
      max-width: 460px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .header {
      margin-bottom: 1.25rem;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .badge {
      font-size: 0.75rem;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      background: rgba(56, 189, 248, 0.15);
      color: var(--primary);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 600;
    }
    .subtitle {
      font-size: 0.8125rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }
    .field {
      margin-bottom: 0.875rem;
    }
    label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 0.3rem;
    }
    input, textarea {
      width: 100%;
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.6rem 0.75rem;
      font-family: inherit;
      font-size: 0.9375rem;
      outline: none;
      transition: border-color 0.15s ease;
    }
    input:focus, textarea:focus {
      border-color: var(--primary);
    }
    textarea {
      min-height: 110px;
      resize: vertical;
    }
    .row {
      display: flex;
      gap: 0.75rem;
    }
    .row .field {
      flex: 1;
    }
    button {
      width: 100%;
      background: var(--primary);
      color: #ffffff;
      border: none;
      border-radius: 6px;
      padding: 0.65rem;
      font-size: 0.9375rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s ease;
      margin-top: 0.25rem;
    }
    button:hover:not(:disabled) {
      background: var(--primary-hover);
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .status {
      margin-top: 0.75rem;
      font-size: 0.875rem;
      text-align: center;
      min-height: 1.25rem;
    }
    .status.success { color: var(--success); }
    .status.error { color: var(--error); }
    .status.sending { color: var(--text-muted); }
    .hint {
      margin-top: 0.5rem;
      font-size: 0.75rem;
      color: var(--text-muted);
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Send Message <span class="badge">#inbox</span></h1>
      <p class="subtitle">Quick note gateway directly to Telegram</p>
    </div>
    <form id="sendForm" method="POST" action="/send">
      <div class="field">
        <label for="message">Message</label>
        <textarea id="message" name="message" placeholder="Type a note (markdown supported)..." required autofocus></textarea>
      </div>
      <div class="row">
        <div class="field">
          <label for="title">Title (optional)</label>
          <input type="text" id="title" name="title" placeholder="e.g. Quick Note">
        </div>
        <div class="field">
          <label for="token">Token (optional)</label>
          <input type="password" id="token" name="token" placeholder="API key">
        </div>
      </div>
      <input type="hidden" name="topic" value="inbox">
      <button type="submit" id="submitBtn">Send to #inbox</button>
      <div id="status" class="status${isSent ? ' success' : errorMessage ? ' error' : ''}">${isSent ? 'Sent to #inbox!' : errorMessage}</div>
      <p class="hint">Press Cmd+Enter or Ctrl+Enter to send</p>
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
    msgInput.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        form.requestSubmit();
      }
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
      statusDiv.className = 'status sending';
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
          statusDiv.textContent = data.error || 'Failed to send message';
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
        }, 4000);
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
