# Telegram Bot Commands

When you add your bot to your Telegram Supergroup as an administrator and register the webhook (`/setup-webhook`), you can control topics, API tokens, and notifications directly from the Telegram chat.

---

## Command Reference

| Command | Arguments | Permissions | Description |
| :--- | :--- | :--- | :--- |
| `/help` | — | All Members | Displays available commands and quick-start guide. |
| `/id` | — | All Members | Displays Chat ID, Thread ID, and your numeric User ID. |
| `/status` | — | All Members | Reports gateway health, KV status, and configuration summary. |
| `/settopic` | `<name>` | Admin | Maps the current forum thread to a custom topic name in KV. |
| `/topics` | — | Admin | Lists all topic name $\rightarrow$ thread ID mappings stored in KV. |
| `/mute` | `[topic] [duration]` | Admin | Mutes notification sounds for a topic (e.g. `1h`, `24h`). |
| `/unmute` | `<topic>` | Admin | Restores notification sounds for a muted topic. |
| `/test` | `[topic]` | Admin | Sends a test notification to verify delivery and formatting. |
| `/token` | `ephemeral [duration]` | Admin | Generates a temporary API token (`1h`, `24h`, `7d`). |
| `/token` | `permanent [label]` | Admin | Generates a permanent API token with an optional label. |
| `/tokens` | — | Admin | Lists all active custom tokens (masked for security). |
| `/revoke` | `<token>` | Admin | Revokes an existing API token immediately. |

---

## Detailed Command Usage

### 1. `/id` (Find Chat & User ID)
Run `/id` anywhere in your supergroup or inside a forum topic. The bot replies with:
```
ℹ️ Chat Diagnostic Info
─────────────────────────────
  Chat ID:   -1001928374650
  Chat Type: supergroup
  Topic ID:  42
  User ID:   987654321 (@yourhandle)
─────────────────────────────
💡 Set TELEGRAM_CHAT_ID in Cloudflare secrets.
```

### 2. `/token` (Generate API Keys)
Create scoped or expiring keys without editing Cloudflare dashboard or wrangler secrets:

```
# Create an ephemeral token valid for 24 hours:
/token ephemeral 24h

# Create a permanent token for GitHub Actions:
/token permanent github-ci
```

The bot replies in chat with the newly generated key.

### 3. `/mute` & `/unmute` (Silence Alerts)
Temporarily mute chat sounds during maintenance windows or server migrations:

```
# Mute current thread for 2 hours:
/mute 2h

# Mute a specific topic for 24 hours:
/mute database 24h

# Resume normal notification sounds:
/unmute database
```

### 4. `/settopic` (Bind Existing Forum Topics)
If you already created a topic manually in Telegram (e.g., `#deployments`), you can link it to a key:
1. Navigate to the `#deployments` topic in Telegram.
2. Send: `/settopic deployments`
3. The bot registers the current thread ID in Cloudflare KV. Future requests to `topic: "deployments"` will route straight here.
