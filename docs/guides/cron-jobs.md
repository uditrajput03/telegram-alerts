# Cron & Shell Scripts

Pipe CLI output directly to Telegram from bash scripts, cron jobs, and system utilities.

---

## Piping Terminal Commands

You can stream command standard output or error output directly to `/notify` using `curl` with `--data-binary @-`:

### 1. Database Backup Verification

```bash
#!/usr/bin/env bash
set -e

BACKUP_FILE="/var/backups/db-$(date +%F).sql.gz"

if pg_dump -U postgres mydb | gzip > "$BACKUP_FILE"; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  curl -s -X POST "https://<YOUR_WORKER_URL>/notify" \
    -H "Content-Type: application/json" \
    -H "x-api-key: <AUTH_TOKEN>" \
    -d "{
      \"title\": \"Database Backup Succeeded\",
      \"message\": \"Backup generated successfully at \`$BACKUP_FILE\` (Size: $SIZE).\",
      \"topic\": \"backups\"
    }"
fi
```

### 2. High Disk Space Warning

Alert if any disk mount exceeds 85% capacity:

```bash
#!/usr/bin/env bash
THRESHOLD=85
USAGE=$(df / | grep / | awk '{ print $5 }' | sed 's/%//g')

if [ "$USAGE" -gt "$THRESHOLD" ]; then
  curl -s -X POST "https://<YOUR_WORKER_URL>/notify" \
    -H "Content-Type: application/json" \
    -H "x-api-key: <AUTH_TOKEN>" \
    -d "{
      \"title\": \"Disk Space Warning\",
      \"message\": \"Root volume is at **${USAGE}%** capacity on host \`$(hostname)\`!\",
      \"topic\": \"ops\"
    }"
fi
```

### 3. Piping Raw Output Directly into Telegram

Send the last 30 lines of an application log file on failure:

```bash
tail -n 30 /var/log/nginx/error.log | curl -s -X POST \
  "https://<YOUR_WORKER_URL>/notify?topic=logs&title=Nginx+Error+Log" \
  -H "x-api-key: <AUTH_TOKEN>" \
  --data-binary @-
```

The gateway automatically places the raw lines into a collapsible `<blockquote expandable>` so it doesn't clutter chat readability.
