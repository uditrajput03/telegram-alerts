# Payloads & Smart Formatting

The gateway transforms incoming plain text and Markdown into valid Telegram HTML, with intelligent features like emoji priority detection, collapsible blockquotes, and graceful catch-all error handling.

---

## Supported Markdown Syntax

You can format your alerts using standard Markdown syntax in the `message` property:

| Markdown Syntax | Telegram Rendered Result |
| :--- | :--- |
| `**bold**` or `*bold*` | Bold text |
| `_italic_` | Italic text |
| `~~strikethrough~~` | Strikethrough text |
| `||spoiler||` | Hidden spoiler text (tap to reveal) |
| `[Title](https://example.com)` | Clickable hyperlink |
| `` `inline code` `` | Monospaced code snippet |
| ` ```bash ... ``` ` | Fenced multiline code block with syntax language tag |
| `> quote` | Standard Telegram blockquote |
| `**> quote` or `>> quote` | Expandable / collapsible blockquote |

---

## Expandable Blockquotes for Logs

Long error stack traces, server logs, or JSON dumps can overwhelm chat rooms. The gateway provides first-class support for Telegram's `<blockquote expandable>` feature:

### Syntax
Prefix any lines with `**>` or `>>` to make the quote collapsible:

```markdown
**> Error: Connection timeout at pg_connect (/app/db.ts:42)
**>   at Pool.connect (/app/node_modules/pg-pool/index.js:123)
**>   at Query.run (/app/node_modules/pg/client.js:45)
```

In Telegram, this renders as a sleek, collapsed section that users can expand on demand.

::: tip Automatic Expansion Threshold
Any quote block exceeding **500 characters** is automatically upgraded to an expandable quote by the gateway, even if sent with standard `> quote` syntax.
:::

---

## Intelligent Priority Emoji Detection

The gateway analyzes your alert `title` and `message` to prepend a relevant status emoji:

| Emoji | Matched Keywords | Example Use Cases |
| :---: | :--- | :--- |
| 🔴 | `error`, `fail`, `crash`, `critical`, `fatal`, `down`, `outage` | Server crashes, failed builds, 500 errors |
| 🟢 | `success`, `resolved`, `complete`, `passed`, `healthy`, `restored` | Backups finished, tests passing, recovery |
| 🚀 | `build`, `deploy`, `release`, `ship`, `publish`, `pipeline` | Production deployments, release tags |
| 🛡️ | `security`, `auth`, `login`, `breach`, `unauthorized` | Suspicious logins, firewall alerts |
| 🟠 | `warn`, `alert`, `caution`, `degraded`, `timeout`, `slow` | High CPU / RAM, slow queries |
| 🗄️ | `database`, `db`, `sql`, `migration`, `backup`, `replica` | DB migrations, replica lag |
| 💳 | `payment`, `invoice`, `billing`, `subscription`, `charge` | Stripe invoices, payment failures |
| 🧪 | `test`, `ci`, `spec`, `coverage`, `lint` | Vitest / Jest test suites |
| 👤 | `user`, `signup`, `registration`, `onboard` | New customer notifications |
| 🔵 | `info`, `update`, `notice`, `changelog` | General updates |
| 🔔 | *(Default fallback)* | Uncategorized notifications |

---

## Catch-All Payload Recovery

When third-party services (such as generic webhooks or raw loggers) send arbitrary JSON or plain text payloads that do not have a `message` field:

1. The gateway does **not** reject or discard the request.
2. The payload is automatically captured, formatted, and routed to the **`#catchall`** forum topic.
3. Unrecognized JSON is prettified inside a collapsible blockquote, so you never lose critical payload data.
