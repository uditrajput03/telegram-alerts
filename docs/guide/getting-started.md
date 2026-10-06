# Getting Started

Welcome to **Telegram Alerts Gateway**! This guide walks you through setting up and deploying your serverless notification gateway in under 5 minutes.

---

## Prerequisites

Before starting, ensure you have:

1. **A Telegram Bot Token**: Created via [@BotFather](https://t.me/BotFather).
2. **A Telegram Supergroup**: With **Forum Topics** enabled. Add your bot to the group as an administrator with permissions to manage topics.
3. **Node.js 20+** installed on your machine.
4. **Cloudflare Account**: With the [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) authenticated (`npx wrangler login`).

---

## 1. Clone & Install

Clone the repository and install dependencies:

```bash
git clone https://github.com/uditrajput03/telegram-alerts.git
cd telegram-alerts
npm install
```

---

## 2. Create Cloudflare KV Namespaces

The gateway uses Cloudflare KV to store dynamic topic thread IDs, tokens, and mute settings.

Run the following commands to generate production and preview KV namespaces:

```bash
npx wrangler kv namespace create GATEWAY_KV
npx wrangler kv namespace create GATEWAY_KV --preview
```

Copy `wrangler.toml.example` to `wrangler.toml`:

```bash
cp wrangler.toml.example wrangler.toml
```

Paste the namespace IDs returned in the command output into your `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "GATEWAY_KV"
id = "your_production_kv_id"
preview_id = "your_preview_kv_id"
```

---

## 3. Configure Secrets

Store your credentials securely in Cloudflare:

```bash
# Telegram bot token from @BotFather
npx wrangler secret put TELEGRAM_BOT_TOKEN

# Supergroup chat ID, e.g. -1001234567890
npx wrangler secret put TELEGRAM_CHAT_ID

# Master static API token for authenticating calls
npx wrangler secret put AUTH_TOKEN

# Secret token for verifying Telegram webhook updates
# (Generate a random string, e.g. with `openssl rand -hex 24`)
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

::: tip Finding your Supergroup Chat ID
If you do not know your supergroup chat ID, proceed to step 4, deploy the worker, add your bot to the group, and send `/id` in the group chat. The bot will reply with your chat ID!
:::

---

## 4. Deploy to Cloudflare Workers

Deploy your worker to Cloudflare's global edge network:

```bash
npm run deploy
```

Take note of the deployed URL printed by Wrangler, for example:  
`https://telegram-alerts.<your-subdomain>.workers.dev`

---

## 5. Register Telegram Webhook

To allow the bot to receive in-chat commands (such as `/token` and `/mute`), register the webhook endpoint with Telegram:

```bash
curl "https://<YOUR_WORKER_URL>/setup-webhook?token=<AUTH_TOKEN>"
```

The gateway registers the webhook and configures Telegram to sign all incoming updates with `TELEGRAM_WEBHOOK_SECRET`.

---

## 6. Send Your First Alert!

You're all set! Send a test alert to verify the integration:

```bash
curl -X POST "https://<YOUR_WORKER_URL>/notify" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <AUTH_TOKEN>" \
  -d '{
    "title": "Setup Complete",
    "message": "Hello from Telegram Alerts Gateway! 🚀",
    "topic": "announcements"
  }'
```

Notice that the gateway automatically creates an **#announcements** forum topic in your Telegram supergroup if it doesn't already exist!
