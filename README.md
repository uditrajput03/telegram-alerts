# 📡 Personal Notification Gateway (Cloudflare Workers + Telegram Topics)

A clean, serverless notification gateway running on **Cloudflare Workers (TypeScript)** and **Hono**. It receives alerts from scripts, servers, webhooks, and CLI commands, dynamically creating and organizing them into **Telegram Supergroup Forum Topics**.

---

## 🎯 Architecture: 3 System Topics + 100% Dynamic Topics

All cluttered static categories (like critical, dev, sales) have been removed. Instead, the gateway relies on a simple, robust topic model:

### 1. System Topics
| Topic | Purpose | Behavior |
|---|---|---|
| `unknown` | **Unauthenticated Requests** | Catches messages sent without auth. Tagged with `🔓 Unverified Source`, strictly quarantined, and delivered silently. |
| `catchall` | **Raw / Structural Recovery** | If someone sends unformatted raw text, malformed JSON, or third-party webhooks without a `message` field, the entire payload is safely recovered and formatted inside a code block. **Messages are never dropped.** |
| `general` | **Default / Fallback** | Default main chat thread when no topic is specified or as ultimate fallback. |

### 2. 100% Dynamic Topics & Self-Healing
- **Auto-Created On Demand**: Any named topic (e.g. `topic: "database"`, `topic: "stripe"`, `topic: "deployments"`) is created automatically:
  1. The gateway checks Cloudflare KV for the topic.
  2. If not found, it calls Telegram's `createForumTopic` API to **dynamically create the topic** in your supergroup.
  3. It caches the thread ID in KV so all future alerts go straight to that topic.
- **🔄 Instant Self-Healing**: If you ever delete or close a forum topic in Telegram, the gateway detects the missing thread error, **automatically purges the stale KV cache, recreates the topic on the fly in Telegram**, and delivers the message directly to the new topic. **Messages never leak into the General chat.**
- **Direct Numeric IDs**: You can also pass direct numeric topic IDs: `topic: 42`.

---

## 🎨 Clean Card Layout & Smart Features

- **Contextual Priority Emojis**: Automatically scans title and message text to prefix the alert with intuitive status indicators:
  - 🔴 Error / Panic / Outage / Crash / Broken
  - 🟠 Warning / Caution / Degraded / Timeout
  - 🟢 Success / Resolved / Fixed / Restored
  - 🚀 Build / Deploy / Pipeline / Ship
  - 🛡️ Security / Auth / Unauthorized
  - 🗄️ Database / Migration / Backup
  - 🔵 Info / Notice / Changelog
  - 💳 Payment / Billing / Subscription
  - 🧪 Testing / CI / Lint
- **Markdown & Telegram HTML**: Full support for markdown `**bold**`, `_italic_`, `~~strike~~`, `||spoiler||`, expandable blockquotes (`**>` or `>>` or quotes > 3 lines), inline `` `code` ``, syntax-highlighted ```` ```pre blocks``` ````, blockquotes (`>`), and links (`[label](url)`).
- **Expandable Blockquotes**: Collapse long stack traces, logs, or multi-line quotes into a single line with an inline expand toggle using `**>` or `>>`, keeping topic threads clean.
- **Tap-to-Reveal Spoilers**: Large catch-all dumps or payload bodies exceeding 500 characters are automatically wrapped in `<tg-spoiler>` so topics stay readable without wall-of-text spam.
- **🌙 Configurable Quiet Hours**: Set `QUIET_HOURS_START`, `QUIET_HOURS_END`, and `TIMEZONE` in `wrangler.toml` (e.g. 23:00 to 07:00). Alerts arriving during these hours are automatically silenced (`disable_notification: true`). Unverified and catch-all alerts are always muted.

---

## 🔒 Security Hardening

- 🔐 **Strict Webhook Authentication (SEC-01)**: `TELEGRAM_WEBHOOK_SECRET` is strictly mandatory for bot commands. Any webhook update missing Telegram's secret token header (`x-telegram-bot-api-secret-token`) is immediately rejected with `401 Unauthorized`. Unconfigured servers reject all webhook calls, completely preventing spoofing attacks.
- 🛡️ **Protected Setup Endpoint (SEC-05)**: `/setup-webhook` requires static master `AUTH_TOKEN` verification, preventing unauthorized internet scans from triggering or reconfiguring your bot's webhook.
- 🛡️ **Topic Quarantine (SEC-03)**: Unauthenticated requests cannot bypass quarantine using `topic_id` or custom topics—they are strictly isolated to the `#unknown` topic.
- 🚫 **Probe & Scanner Rejection (SEC-04)**: Empty payloads (`{}`), blank requests, or automated internet port scanners are rejected with `400 Bad Request` and never trigger notification spam.
- 🛡️ **Tag-Balanced HTML Truncation (SEC-06)**: Long logs or raw webhook dumps are truncated safely while auto-closing HTML tags (`</code></pre>`, `</b>`, `</i>`), preventing Telegram `400 Bad Request: can't parse entities` delivery failures.
- 🔑 **Isolated KV Keys**: Dynamic topics are stored per-topic in Cloudflare KV without shared mutable bottlenecks.

---

## 📡 API Usage & curl Snippets

### 1. Dynamic Topic Alert (Auto-Creates Topic)
```bash
curl -X POST "https://<WORKER_URL>/notify" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <AUTH_TOKEN>" \
  -d '{
    "title": "Postgres Migration",
    "message": "Migration `2026_10_07_add_users` applied in **1.2s**.",
    "topic": "database"
  }'
```

### 2. URL Path Shortcuts
You can also trigger notifications directly via URL subpaths:
```bash
# Simple ping message
curl "https://<WORKER_URL>/notify/Server+Online?token=<AUTH_TOKEN>"

# Title and Message via path segments: /notify/<title>/<message>
curl "https://<WORKER_URL>/notify/Deploy/Production+build+v1.4+complete?token=<AUTH_TOKEN>"
```

### 3. Direct Topic ID Override
```bash
curl -X POST "https://<WORKER_URL>/notify" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <AUTH_TOKEN>" \
  -d '{
    "message": "Direct message to thread 42",
    "topic": 42
  }'
```

### 4. Piping Terminal CLI Logs
```bash
echo "Backup finished successfully" | curl -X POST "https://<WORKER_URL>/notify?topic=backups&title=Nightly+Cron" \
  -H "x-api-key: <AUTH_TOKEN>" \
  --data-binary @-
```

### 5. Quick Ping via GET Request
```bash
curl "https://<WORKER_URL>/notify?token=<AUTH_TOKEN>&topic=health&title=Ping&message=All+systems+operational"
```

### 6. Catch-All Structural Recovery (Third-party / Raw Webhooks)
If a third-party service (e.g. Stripe, GitHub, raw JSON) sends a payload without a standard `message` field:
```bash
curl -X POST "https://<WORKER_URL>/notify" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <AUTH_TOKEN>" \
  -d '{
    "event": "charge.succeeded",
    "data": { "amount": 9900, "currency": "usd" }
  }'
```
The gateway catches it, formats the raw query and JSON body inside a code block, and posts it to the **`catchall`** topic.

### 7. Unauthenticated Catch-All
If sent without an auth token:
```bash
curl -X POST "https://<WORKER_URL>/notify" \
  -H "Content-Type: application/json" \
  -d '{ "message": "Unknown webhook ping" }'
```
Automatically routed to the **`unknown`** topic, muted silently, and tagged with `🔓 Unverified Source`.

---

## 🐚 Shell Helper Function (`notify()`)

Add to `~/.bashrc` or `~/.zshrc`:

```bash
# Personal Notification Gateway Helper
notify() {
  local GATEWAY_URL="https://tg.codekit.workers.dev"
  local AUTH_TOKEN="<YOUR_TOKEN>"

  local TOPIC="general"
  local TITLE=""
  local SILENT="false"

  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      -t|--topic) TOPIC="$2"; shift 2 ;;
      --title) TITLE="$2"; shift 2 ;;
      -s|--silent) SILENT="true"; shift 1 ;;
      *) break ;;
    esac
  done

  local MESSAGE="$*"
  if [ -z "$MESSAGE" ]; then
    MESSAGE=$(cat)
  fi

  if [ -z "$MESSAGE" ]; then
    echo "Usage: notify [-t topic] [--title title] [-s] <message>"
    echo "   or: command | notify [-t topic]"
    return 1
  fi

  curl -s -X POST "${GATEWAY_URL}/notify" \
    -H "Content-Type: application/json" \
    -H "x-api-key: ${AUTH_TOKEN}" \
    -d "$(jq -n \
      --arg msg "$MESSAGE" \
      --arg title "$TITLE" \
      --arg topic "$TOPIC" \
      --argjson silent "$SILENT" \
      '{message: $msg, title: $title, topic: $topic, silent: $silent}')" > /dev/null
}
```

---

## 🛠️ Setup & Deployment

### 1. Create Cloudflare KV Namespace
```bash
npx wrangler kv:namespace create GATEWAY_KV
npx wrangler kv:namespace create GATEWAY_KV --preview
```
Add the output IDs to your `wrangler.toml`.

### 2. Configure Worker Secrets
```bash
# Telegram Bot Token from @BotFather
npx wrangler secret put TELEGRAM_BOT_TOKEN

# Supergroup Chat ID (e.g. -100xxxxxxxxxx)
npx wrangler secret put TELEGRAM_CHAT_ID

# Master Auth Token for API authentication
npx wrangler secret put AUTH_TOKEN

# Mandatory Webhook Secret Token for Telegram Bot Commands (SEC-01)
# Generate any random alphanumeric string (e.g. openssl rand -hex 24)
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

### 3. Deploy to Cloudflare Workers
```bash
npm run deploy
```

### 4. Register Telegram Webhook (1-Click)
Once deployed, activate your bot commands (`/help`, `/token`, `/settopic`, etc.) by registering the webhook:
```bash
curl "https://<WORKER_URL>/setup-webhook?token=<AUTH_TOKEN>"
```
*(Or open `https://<WORKER_URL>/setup-webhook?token=<AUTH_TOKEN>` in your browser).*

> [!IMPORTANT]
> The setup route will securely register your `TELEGRAM_WEBHOOK_SECRET` with Telegram. From that moment on, Telegram attaches the secret header to every update, and any webhook request without the exact secret is strictly blocked with `401 Unauthorized`.

---

## 🤖 Telegram Bot Commands

Once the webhook is registered, you can manage the gateway directly inside Telegram:

| Command | Description | Example |
|---|---|---|
| `/help` or `/start` | Displays interactive help menu with all commands | `/help` |
| `/id` | Diagnostic info: chat ID, user ID, current topic ID | `/id` |
| `/status` or `/health` | Gateway operational health, mapped topics, and tokens | `/status` |
| `/mute [topic] [duration]` | Mutes alerts for a topic in KV (e.g. 1h, 4h, 24h, 7d) | `/mute deploy 2h` |
| `/unmute <topic>` | Resumes loud notification delivery for a topic | `/unmute deploy` |
| `/test [topic]` | Dispatches end-to-end verification ping to topic | `/test deploy` |
| `/settopic <name>` | Binds the current forum topic to `<name>` in KV | `/settopic prod-deploy` |
| `/topics` | Lists all mapped forum topics | `/topics` |
| `/token ephemeral` | Generates a time-limited token stored in KV | `/token ephemeral 24h ci-runner` |
| `/token permanent` | Generates a persistent API token | `/token permanent backup-server` |
| `/tokens` | Lists active tokens, labels, and expiration times | `/tokens` |
| `/revoke <token>` | Instantly revokes an active token | `/revoke tg_perm_...` |

> [!NOTE]
> Bot management commands (`/token`, `/settopic`, `/revoke`, `/mute`, `/unmute`, `/test`, `/status`) are protected: only group creators/administrators (or IDs listed in `ADMIN_USER_ID`) can execute them.

---

## 🧪 Testing

```bash
# Run unit & integration test suite (Vitest)
npm run test

# TypeScript typechecking
npm run build
```

---

## 📄 License
Apache-2.0