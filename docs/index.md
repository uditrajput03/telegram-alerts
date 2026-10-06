---
layout: home

hero:
  name: "Telegram Alerts"
  text: "Serverless Notification Gateway"
  tagline: "Accept webhooks, alerts, and terminal streams — route them automatically into Telegram forum topics with zero server costs."
  image:
    src: /logo.svg
    alt: Telegram Alerts Logo
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /reference/api
    - theme: alt
      text: View on GitHub
      link: https://github.com/uditrajput03/telegram-alerts

features:
  - icon: ⚡️
    title: Dynamic Forum Topics
    details: Pass any topic name. The gateway checks Cloudflare KV, creates the topic on Telegram on the fly, and caches the thread ID permanently.
  - icon: 🌐
    title: Built-in Web Composer
    details: Access /send directly in your browser with keyboard shortcuts (Cmd+Enter), token persistence, and immediate delivery to the inbox topic.
  - icon: 🔑
    title: In-Chat Token Management
    details: Issue permanent or auto-expiring API tokens directly inside Telegram chat with /token without touching environment variables.
  - icon: 🌙
    title: Topic Muting & Quiet Hours
    details: Mute noisy channels during downtime or configure quiet hours to silence non-critical alerts overnight.
  - icon: 📝
    title: Smart Formatting & Collapsible Traces
    details: Automatically converts Markdown to Telegram HTML, wraps long stack traces into expandable blockquotes, and balances HTML tags.
  - icon: 🛡️
    title: Safe Payload Recovery
    details: Third-party webhook payloads or unformatted requests land safely in a catchall topic instead of failing or being dropped.
---

<div style="margin-top: 4rem; text-align: center;">

### Quick Example

Send an alert from anywhere with a single curl command:

</div>

```bash
curl -X POST "https://<YOUR_WORKER_URL>/notify" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <AUTH_TOKEN>" \
  -d '{
    "title": "Postgres Migration",
    "message": "Migration completed successfully in 1.2s",
    "topic": "database"
  }'
```
