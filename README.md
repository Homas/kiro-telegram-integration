# kiro-telegram-integration

Remote approval and information gathering for [Kiro IDE](https://kiro.dev) via Telegram. When Kiro needs your confirmation or additional input, it sends a message to your Telegram chat — approve, cancel, or reply without leaving your phone.

Delivered as an **MCP server** (primary) and a **VS Code extension** (secondary). Both share the same core library.

## Quick Start

### Prerequisites

- **Node.js v18+** (required for native `fetch`)
- A Telegram bot created via [BotFather](https://t.me/BotFather)

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts to name your bot.
3. Copy the **Bot Token** BotFather gives you.
4. Send a message to your new bot, then visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` to find your **Chat ID** in the response JSON under `message.chat.id`.

### 2. Install & Configure

```bash
git clone <repo-url> kiro-telegram-integration
cd kiro-telegram-integration
npm install
npm run build
```

#### MCP Server (recommended)

Add to your MCP configuration (e.g. `~/.kiro/settings/mcp.json`):

```json
{
  "mcpServers": {
    "telegram-integration": {
      "command": "node",
      "args": ["/absolute/path/to/kiro-telegram-integration/dist/mcp/server.js"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "<your-bot-token>",
        "TELEGRAM_CHAT_ID": "<your-chat-id>"
      }
    }
  }
}
```

#### VS Code Extension

Configure via VS Code settings:

| Setting | Description | Default |
|---|---|---|
| `kiroTelegram.botToken` | Telegram bot token from BotFather | — |
| `kiroTelegram.chatId` | Telegram chat ID | — |
| `kiroTelegram.timeoutMinutes` | Request timeout in minutes | `10` |

## Architecture

```
src/
├── core/              # Delivery-agnostic Telegram logic
│   ├── ConfigManager  # Config loading, validation, connectivity check
│   ├── MessageSender  # Message formatting, sending, retry logic
│   ├── RequestRegistry# Pending request lifecycle & timeout management
│   ├── UpdatePoller   # Long-polling for Telegram updates
│   ├── ResponseRouter # Routes incoming updates to pending requests
│   ├── IntegrationService # Public API consumed by adapters
│   └── types          # Shared interfaces and type definitions
├── mcp/               # MCP server adapter (primary)
│   ├── server         # Entry point, stdio transport
│   └── tools          # MCP tool definitions
└── extension/         # VS Code extension adapter (secondary)
    ├── extension      # Activate/deactivate lifecycle
    ├── commands       # VS Code command registrations
    └── statusBar      # Connection status indicator
```

Both adapters are thin wrappers that delegate to `IntegrationService`. The core library has zero knowledge of how it is hosted.

## MCP Tools

| Tool | Description |
|---|---|
| `telegram_confirm` | Send a confirmation request (Approve/Cancel buttons). Returns `approved`, `cancelled`, or `timed_out`. |
| `telegram_ask` | Send an information request. Returns the user's text reply or `timed_out`. |
| `telegram_notify` | Send a one-way notification (no response expected). |
| `telegram_status` | Check connection status and pending request count. |

## Message Types

### Confirmation Request

Sent when Kiro needs approval. Includes action type, summary, affected files, and inline keyboard buttons (Approve / Cancel). Uses `MarkdownV2` formatting.

### Information Request

Sent when Kiro needs textual input. Includes the prompt and context. Uses Telegram's `ForceReply` markup so your client prompts a direct reply.

### Notifications

One-way messages for status updates. No response expected.

## Timeout Behavior

- Default timeout: **10 minutes** (configurable via `timeoutMs` / `kiroTelegram.timeoutMinutes`).
- When a request times out, the original Telegram message is edited to show it has expired.
- Responding to an expired request sends a notification that the request is no longer active.

## Connection Resilience

- **Send failures**: Retried up to **3 times** with exponential backoff. HTTP 4xx errors are not retried.
- **Polling failures**: Reconnects with exponential backoff capped at **60 seconds**.
- **Offset tracking**: Polling resumes from the last processed `update_id` after reconnection.

## Message Limits

Messages exceeding Telegram's **4096-character** limit are truncated at 4050 characters with a truncation indicator appended.

## Troubleshooting

| Problem | Solution |
|---|---|
| "Configuration error" on startup | Ensure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set. For MCP, check your `mcp.json` env block. For VS Code, check settings. |
| "Bot API unreachable" | Verify your bot token is correct by visiting `https://api.telegram.org/bot<TOKEN>/getMe`. Check network connectivity. |
| No messages received | Confirm your Chat ID is correct. Send a message to your bot first, then re-check `getUpdates`. |
| Responses not matching | Ensure you're replying to the correct message (use Telegram's reply feature for information requests). |
| Timeout too short/long | Adjust `timeoutMs` in MCP env or `kiroTelegram.timeoutMinutes` in VS Code settings. |
| MCP server won't start | Verify Node.js v18+ is installed (`node --version`). Check that `npx kiro-telegram-integration` runs without errors. |

## Security Considerations

- **Bot Token storage**: The bot token is passed via environment variables (MCP) or VS Code's settings API (extension). It is never logged or displayed in UI elements. Avoid committing tokens to version control.
- **Chat ID validation**: The integration only sends messages to and accepts responses from the configured Chat ID. Validate your Chat ID before use.
- **Data in transit**: All communication with the Telegram Bot API uses HTTPS (TLS encryption). No data is sent over unencrypted channels.
- **Recommended Telegram privacy settings**:
  - Enable [Group Privacy mode](https://core.telegram.org/bots/features#privacy-mode) for your bot (enabled by default).
  - Use a private chat with your bot rather than a group chat.
  - Do not share your bot token. If compromised, revoke it via BotFather (`/revoke`).
- **No persistent storage**: Pending requests are held in memory only. No sensitive data is written to disk.

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm test             # Run tests (vitest)
```

## License

This project is licensed under the [MIT License](./LICENSE).
