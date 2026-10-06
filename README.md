# Telegram notification gateway

A serverless gateway running on Cloudflare Workers and Hono. It accepts alerts from scripts, servers, webhooks, and command line tools, and routes them into Telegram supergroup forum topics.

## Features

* **Dynamic forum topics.** Pass a topic name in your request. The gateway checks Cloudflare KV for the topic thread, creates the topic on Telegram if it does not exist, and caches the thread ID. If a topic is deleted in Telegram, the gateway recreates it automatically.
* **Web composer.** Visiting `/send` in your browser opens a clean form that delivers messages directly to the `#inbox` topic.
* **Token management in chat.** Create permanent or expiring API tokens directly inside Telegram with `/token`.
* **Topic muting and quiet hours.** Silence alerts during night hours via configuration, or temporarily mute specific topics with `/mute`.
* **Markdown and collapsible quotes.** Formats markdown into Telegram HTML, collapses long error traces into expandable blockquotes, and balances HTML tags during truncation.
* **Payload recovery.** Requests with unrecognized structures or third-party webhook payloads land safely in a catchall topic instead of being dropped.

## Prerequisites

1. A Telegram bot token from `@BotFather`.
2. A Telegram supergroup with forum topics enabled. Add your bot to the group as an administrator with rights to manage topics.
3. Node.js 20 or higher.
4. A Cloudflare account with Wrangler CLI.

## Setup and deployment

### 1. Clone repository and install dependencies

```bash
git clone https://github.com/uditrajput03/telegram-alerts.git
cd telegram-alerts
npm install
```

### 2. Create the Cloudflare KV namespace

Create the production and preview namespaces:

```bash
npx wrangler kv namespace create GATEWAY_KV
npx wrangler kv namespace create GATEWAY_KV --preview
```

Copy `wrangler.toml.example` to `wrangler.toml`:

```bash
cp wrangler.toml.example wrangler.toml
```

Paste the namespace IDs from the command output into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "GATEWAY_KV"
id = "your_production_kv_id"
preview_id = "your_preview_kv_id"
```

### 3. Configure secrets

Run the following commands to store your credentials securely:

```bash
# Telegram bot token from @BotFather
npx wrangler secret put TELEGRAM_BOT_TOKEN

# Supergroup chat ID, for example -1001234567890
npx wrangler secret put TELEGRAM_CHAT_ID

# Master static token for authenticating API calls
npx wrangler secret put AUTH_TOKEN

# Secret token for Telegram webhook requests
# Generate any random string, for example using openssl rand -hex 24
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

#### How to find your chat ID

If you do not know your supergroup chat ID, deploy the worker first, add your bot to the group, and send `/id` in the group chat. The bot will print the numeric chat ID.

### 4. Deploy to Cloudflare Workers

```bash
npm run deploy
```

Take note of the deployment URL printed by Wrangler, for example `https://telegram-alerts.<your-subdomain>.workers.dev`.

### 5. Register the Telegram webhook

Register your webhook endpoint with Telegram so the bot can receive commands:

```bash
curl "https://<YOUR_WORKER_URL>/setup-webhook?token=<AUTH_TOKEN>"
```

The gateway confirms registration and applies your webhook secret. Telegram attaches this secret to every update, and requests without the secret are rejected.

## Sending alerts

### Web interface

Visit `https://<YOUR_WORKER_URL>/send` in any browser.

The page provides a message field, optional title and token inputs, keyboard shortcuts with Cmd+Enter, and saves your token locally so you do not need to retype it. All messages from this page route to the `inbox` topic.

### JSON payload

```bash
curl -X POST "https://<YOUR_WORKER_URL>/notify" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <AUTH_TOKEN>" \
  -d '{
    "title": "Postgres Migration",
    "message": "Migration complete in 1.2s",
    "topic": "database"
  }'
```

### URL path shortcut

```bash
curl "https://<YOUR_WORKER_URL>/notify/Deploy/Build+v1.4+complete?token=<AUTH_TOKEN>"
```

### Piping terminal output

```bash
echo "Backup finished successfully" | curl -X POST \
  "https://<YOUR_WORKER_URL>/notify?topic=backups&title=Nightly+Cron" \
  -H "x-api-key: <AUTH_TOKEN>" \
  --data-binary @-
```

### Raw webhooks

If a service sends payloads without a standard message property, the gateway recovers the raw body and queries into the `catchall` topic inside a collapsible code block.

## Payload reference

| Field | Type | Description |
|---|---|---|
| `message` | string | Alert body text. Required. Supports markdown. |
| `title` | string | Alert header title. Optional. |
| `topic` | string or number | Destination topic name or numeric thread ID. Defaults to General. |
| `silent` | boolean | Disables notification sound when true. |

## Telegram bot commands

Send these commands directly in your Telegram group:

| Command | Description | Example |
|---|---|---|
| `/help` or `/start` | Displays interactive help menu | `/help` |
| `/docs` or `/api` | Shows curl examples and payload reference | `/docs` |
| `/id` | Displays chat ID, user ID, and current thread ID | `/id` |
| `/status` | Shows operational health, topic counts, and mute state | `/status` |
| `/mute <topic> [time]` | Mutes alerts for a topic, for example 1h, 4h, 24h, 7d | `/mute deploy 2h` |
| `/unmute <topic>` | Restores notification sound for a topic | `/unmute deploy` |
| `/test <topic>` | Sends an end-to-end test alert to a topic | `/test deploy` |
| `/settopic <name>` | Binds the current forum thread to a topic name | `/settopic deploy` |
| `/topics` | Lists all mapped topics and thread IDs | `/topics` |
| `/token ephemeral [time]` | Generates a temporary token stored in KV | `/token ephemeral 24h ci-runner` |
| `/token permanent [label]` | Generates a permanent API token | `/token permanent backup-server` |
| `/tokens` | Lists active tokens and expiration times | `/tokens` |
| `/revoke <token>` | Revokes an active token | `/revoke tg_perm_...` |

Management commands are restricted to group creators, administrators, or users listed in `ADMIN_USER_ID`.

## Shell helper function

Add this function to your `~/.bashrc` or `~/.zshrc`:

```bash
notify() {
  local GATEWAY_URL="https://<YOUR_WORKER_URL>"
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

## Configuration reference

Set these optional variables under `[vars]` in `wrangler.toml`:

| Variable | Description | Default |
|---|---|---|
| `ADMIN_USER_ID` | Comma separated Telegram user IDs allowed to manage tokens and topics | Unset, defaults to group admins |
| `QUIET_HOURS_START` | Hour of day when quiet hours start, from 0 to 23 | Unset |
| `QUIET_HOURS_END` | Hour of day when quiet hours end, from 0 to 23 | Unset |
| `TIMEZONE` | IANA timezone name, for example America/New_York or UTC | UTC |
| `UNKNOWN_TOPIC_ID` | Numeric thread ID override for unauthenticated messages | Auto-created topic |
| `CATCHALL_TOPIC_ID` | Numeric thread ID override for raw structural recovery | Auto-created topic |

## Testing

```bash
# Run unit and integration tests
npm test

# Run TypeScript type check
npm run build
```

## License

Apache-2.0