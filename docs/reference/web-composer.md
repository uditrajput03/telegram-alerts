# Web Composer (`/send`)

The gateway includes a built-in, lightweight web composer at `https://<YOUR_WORKER_URL>/send`. It provides an immediate, user-friendly UI to send messages to your Telegram group without needing command-line tools.

---

## Features

- **Direct Delivery to `#inbox`**: Every message dispatched from `/send` is routed automatically to the designated `#inbox` forum topic.
- **Local Token Storage**: Your API token is saved in browser `localStorage`. You only need to enter it once.
- **Keyboard Shortcuts**: Press <kbd>Cmd</kbd> + <kbd>Enter</kbd> (macOS) or <kbd>Ctrl</kbd> + <kbd>Enter</kbd> (Windows/Linux) to send quickly.
- **Responsive Dark & Light Mode**: Automatically adapts to your system OS color preferences.
- **Zero Assets Overhead**: The HTML page is self-contained with no external CDN stylesheets or scripts.

---

## Form Fields

| Field | Required | Description |
| :--- | :--- | :--- |
| **Message** | **Yes** | The notification text. Supports Markdown formatting (bold, italic, code blocks, lists). |
| **Title** | No | An optional header for the message. |
| **Auth Token** | **Yes** | Your API token (`AUTH_TOKEN` or dynamic chat token). Stored locally in your browser. |

---

## Accessing the Composer

Simply navigate to your worker deployment:

```
https://<YOUR_WORKER_URL>/send
```

Bookmark this URL on your desktop or mobile home screen for instantaneous push notes to your Telegram supergroup!
