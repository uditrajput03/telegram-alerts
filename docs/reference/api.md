# REST API Reference

The Telegram Alerts Gateway exposes clean, flexible endpoints for programmatic notifications.

---

## Authentication

All requests to `/notify` require authentication unless sent to the unauthenticated topic fallback. You can authenticate using any of the following methods:

1. **Header (Recommended):**
   ```http
   x-api-key: <AUTH_TOKEN>
   ```
2. **Bearer Token:**
   ```http
   Authorization: Bearer <AUTH_TOKEN>
   ```
3. **Query Parameter:**
   ```
   ?token=<AUTH_TOKEN>
   ```

Both the master `AUTH_TOKEN` (set in Cloudflare secrets) and in-chat generated tokens (`/token`) are accepted.

---

## 1. Send Alert (JSON)

### `POST /notify`

Delivers a structured notification to a specific Telegram topic.

#### Request Headers
- `Content-Type: application/json`
- `x-api-key: <AUTH_TOKEN>`

#### Request Body (JSON)

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `message` | `string` | **Yes** | Notification body text. Supports Markdown formatted text. |
| `title` | `string` | No | Bold header title displayed at the top of the message. |
| `topic` | `string \| number` | No | Target forum topic name (e.g. `"database"`) or numeric thread ID. Defaults to `General`. |
| `silent` | `boolean` | No | When `true`, disables sound and vibration notification in Telegram. |

#### Examples

::: code-group

```bash [curl]
curl -X POST "https://<YOUR_WORKER_URL>/notify" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <AUTH_TOKEN>" \
  -d '{
    "title": "PostgreSQL Migration",
    "message": "Migration `20250325_init` applied in 1.4s.",
    "topic": "database",
    "silent": false
  }'
```

```javascript [TypeScript / Fetch]
const response = await fetch("https://<YOUR_WORKER_URL>/notify", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": process.env.AUTH_TOKEN!,
  },
  body: JSON.stringify({
    title: "User Signup",
    message: "New user registered: user@example.com",
    topic: "users",
  }),
});

const data = await response.json();
console.log(data);
```

```python [Python (requests)]
import requests

url = "https://<YOUR_WORKER_URL>/notify"
headers = {
    "Content-Type": "application/json",
    "x-api-key": "<AUTH_TOKEN>"
}
payload = {
    "title": "Backup Completed",
    "message": "Nightly S3 database snapshot finished: 4.2 GB",
    "topic": "backups"
}

response = requests.post(url, json=payload, headers=headers)
print(response.json())
```

:::

#### Response (`200 OK`)

```json
{
  "success": true,
  "message_id": 1420,
  "topic": "database",
  "topic_id": 42,
  "target_topic_id": 42,
  "delivered_to": "Topic 42",
  "is_catchall": false,
  "silent": false,
  "is_verified": true,
  "token_type": "master"
}
```

---

## 2. Pipe Terminal Output

### `POST /notify` (Raw Plaintext)

Pipe output from CLI commands, scripts, or Docker builds directly to Telegram:

```bash
echo "Backup finished successfully" | curl -X POST \
  "https://<YOUR_WORKER_URL>/notify?topic=backups&title=Nightly+Cron" \
  -H "x-api-key: <AUTH_TOKEN>" \
  --data-binary @-
```

```bash
docker build -t app:latest . 2>&1 | tail -n 25 | curl -X POST \
  "https://<YOUR_WORKER_URL>/notify?topic=ci&title=Docker+Build" \
  -H "x-api-key: <AUTH_TOKEN>" \
  --data-binary @-
```

---

## 3. URL Path Shortcut

### `GET /notify/:title/:message`

Fast notifications without request bodies or JSON formatting. Perfect for quick browser bookmarks, ping tools, or IoT triggers:

```bash
curl "https://<YOUR_WORKER_URL>/notify/Deploy/Build+v1.4+complete?token=<AUTH_TOKEN>"
```

- Path segments before `/` are treated as the `title`, and subsequent segments as the `message`.

---

## 4. Query Parameters

### `GET /notify`

```bash
curl "https://<YOUR_WORKER_URL>/notify?title=Server+Reboot&message=Host+rebooted+normally&topic=ops&token=<AUTH_TOKEN>"
```

| Parameter | Alias | Description |
| :--- | :--- | :--- |
| `message` | `m`, `msg` | Alert body content |
| `title` | `t` | Alert title |
| `topic` | `c`, `category` | Forum topic name |
| `silent` | — | `true` or `1` to silence notifications |
| `token` | — | API key for authentication |

---

## 5. Health Check

### `GET /health`

Returns service status without requiring authentication. Useful for UptimeRobot, BetterStack, or Pingdom monitoring.

```bash
curl "https://<YOUR_WORKER_URL>/health"
```

```json
{
  "status": "healthy",
  "timestamp": "2025-03-25T10:00:00.000Z",
  "service": "telegram-alerts"
}
```

---

## HTTP Status Codes

| Status Code | Meaning | Description |
| :--- | :--- | :--- |
| `200 OK` | Success | Alert was routed and dispatched to Telegram. |
| `400 Bad Request` | Missing Content | Request had no message or payload body. |
| `401 Unauthorized` | Invalid Token | Missing or invalid authentication token. |
| `500 Server Error` | Misconfiguration | Cloudflare secrets (`TELEGRAM_BOT_TOKEN`) missing. |
| `502 Bad Gateway` | Telegram Failure | Telegram Bot API rejected the message (e.g. bot not in group or rate-limited). |
