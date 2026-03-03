# Implementation Plan: Kiro Telegram Integration

## Overview

Incremental implementation of the Kiro Telegram Integration, starting with core types and interfaces, building up each core component with tests, then wiring the MCP server adapter, and finally the VS Code extension adapter. Each task builds on the previous, ensuring no orphaned code.

## Tasks

- [x] 1. Set up project structure, configuration, and core types
  - [x] 1.1 Initialize project with `package.json`, `tsconfig.json`, and install dependencies (vitest, fast-check, @modelcontextprotocol/sdk, @types/vscode)
    - Create `package.json` with `name`, `bin` entry pointing to MCP server, `scripts` for build/test
    - Create `tsconfig.json` targeting ES2022, module NodeNext, strict mode
    - _Requirements: 9.1, 9.3, 11.1_

  - [x] 1.2 Create `src/core/types.ts` with all shared interfaces and type definitions
    - Define `TelegramConfig`, `ActionContext`, `SentMessage`, `RequestType`, `RequestStatus`, `PendingRequest`, `RequestResult`, `ValidationResult`, `ConnectivityResult`, `TelegramUpdate`, `CallbackQuery`, `TelegramMessage`, `RoutingResult`
    - _Requirements: 2.6, 3.5, 7.2_

  - [x] 1.3 Implement `src/core/ConfigManager.ts`
    - Implement `fromRecord()` to build `TelegramConfig` from a flat `Record<string, string | undefined>` with defaults for `timeoutMs`, `maxRetries`, `maxBackoffMs`
    - Implement `validateConfig()` to reject missing, empty, or whitespace-only `botToken` and `chatId`, returning `ValidationResult` with descriptive errors and setup instructions
    - Implement `verifyConnectivity()` to call Telegram `getMe` endpoint and return `ConnectivityResult`
    - Ensure `botToken` is never included in any logged or serialized output
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 1.4 Write property tests for ConfigManager
    - **Property 1: Config validation rejects incomplete configurations**
    - **Validates: Requirements 1.1, 1.2**
    - **Property 2: Bot token is never exposed in serialized output**
    - **Validates: Requirements 1.5**

- [x] 2. Implement MessageSender with formatting and retry logic
  - [x] 2.1 Implement `src/core/MessageSender.ts`
    - Implement `sendConfirmationRequest()` — format MarkdownV2 message with action type, summary, affected files; attach inline keyboard with "Approve" and "Cancel" buttons; callback data encoded as `{requestId}:approve` / `{requestId}:cancel`; send via Telegram `sendMessage` API to configured `chatId`
    - Implement `sendInformationRequest()` — format MarkdownV2 message with prompt and context; attach `force_reply: true` markup; send via Telegram `sendMessage` API
    - Implement `editMessage()` — call Telegram `editMessageText` API for timeout/expiry updates
    - Implement `sendNotification()` — send a plain text message
    - Implement retry logic: retry on HTTP 5xx and network errors up to `maxRetries` times with exponential backoff; do not retry on HTTP 4xx
    - Implement message truncation: truncate at 4050 characters and append truncation indicator if content exceeds 4096 characters
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.4, 6.1, 6.2, 6.3, 6.4, 8.1, 8.2_

  - [x] 2.2 Write property tests for MessageSender
    - **Property 4: Confirmation messages contain complete ActionContext and correct markup**
    - **Validates: Requirements 2.2, 2.3, 6.1, 6.2**
    - **Property 5: Information messages contain prompt, context, and ForceReply markup**
    - **Validates: Requirements 3.2, 3.4, 6.3**
    - **Property 6: All outgoing messages target the configured Chat_ID**
    - **Validates: Requirements 2.1, 3.1**
    - **Property 10: Message truncation respects the 4096-character limit**
    - **Validates: Requirements 6.4**
    - **Property 14: Retry count respects configuration**
    - **Validates: Requirements 8.1**
    - **Property 15: Exponential backoff intervals are bounded**
    - **Validates: Requirements 8.3**

- [x] 3. Implement RequestRegistry
  - [x] 3.1 Implement `src/core/RequestRegistry.ts`
    - Implement `add()` — store a `PendingRequest` in an in-memory `Map` keyed by `id`, start a `setTimeout` timer that resolves the request as `timed_out` when `timeoutMs` elapses
    - Implement `get()`, `isPending()`, `pendingCount()` — lookup and status methods
    - Implement `resolve()` — call the request's `resolve` callback with the result, clear the timeout timer, remove from the map
    - Implement `remove()` — clear timeout timer and delete from map
    - On timeout: resolve with `timed_out` status and remove from registry
    - _Requirements: 4.1, 4.2, 7.1, 7.2, 7.3_

  - [x] 3.2 Write property tests for RequestRegistry
    - **Property 11: Registry add/resolve round trip**
    - **Validates: Requirements 7.2, 7.3**
    - **Property 12: Timeout resolves requests as timed out**
    - **Validates: Requirements 4.1, 4.2**
    - **Property 3: All requests receive unique identifiers**
    - **Validates: Requirements 2.6, 3.5**

- [x] 4. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement UpdatePoller and ResponseRouter
  - [x] 5.1 Implement `src/core/UpdatePoller.ts`
    - Implement `start()` — begin long-polling loop calling Telegram `getUpdates` with the current offset
    - Implement `stop()` — set a flag to stop the polling loop gracefully
    - Implement `onUpdate()` — register a callback handler for incoming `TelegramUpdate` objects
    - Track the last processed `update_id` and use `offset = lastUpdateId + 1` on each poll
    - On poll failure: reconnect with exponential backoff capped at `maxBackoffMs` (60s default)
    - On connectivity restored: resume from last known offset
    - _Requirements: 5.1, 8.3, 8.4_

  - [x] 5.2 Write property tests for UpdatePoller
    - **Property 16: Polling resumes from last known offset**
    - **Validates: Requirements 8.4**

  - [x] 5.3 Implement `src/core/ResponseRouter.ts`
    - Implement `routeUpdate()`:
      - For callback queries: parse `data` field as `{requestId}:{action}`, look up request in registry, resolve with `approved` or `cancelled` status, acknowledge callback query via Telegram `answerCallbackQuery` API
      - For text replies: match `reply_to_message.message_id` to a pending information request's `messageId`, resolve with `answered` status and reply text as data
      - If no matching pending request found: send notification to user via `MessageSender.sendNotification()`
      - If request already resolved/expired: send expiry notification to user
    - _Requirements: 2.4, 2.5, 3.3, 4.4, 5.2, 5.3, 5.4, 5.5_

  - [x] 5.4 Write property tests for ResponseRouter
    - **Property 7: Callback query routing resolves the correct pending request with the correct status**
    - **Validates: Requirements 2.4, 2.5, 5.2**
    - **Property 8: Text reply routing resolves the correct pending information request with the reply text**
    - **Validates: Requirements 3.3, 5.3**
    - **Property 9: Unmatched responses trigger a notification**
    - **Validates: Requirements 5.4**
    - **Property 13: Responses to expired requests trigger an expiry notification**
    - **Validates: Requirements 4.4**
    - **Property 17: Callback data round trip**
    - **Validates: Requirements 5.2**

- [x] 6. Implement IntegrationService and wire core components
  - [x] 6.1 Implement `src/core/IntegrationService.ts`
    - Implement `initialize()` — validate config via `ConfigManager`, verify connectivity, create `MessageSender`, `RequestRegistry`, `UpdatePoller`, `ResponseRouter` instances, start polling, wire `UpdatePoller.onUpdate` to `ResponseRouter.routeUpdate`
    - Implement `requestConfirmation()` — generate unique request ID, send confirmation message via `MessageSender`, register pending request in `RequestRegistry`, return a `Promise<RequestResult>` that resolves when the user responds or timeout elapses; on timeout edit the Telegram message to show expiry
    - Implement `requestInformation()` — generate unique request ID, send information request via `MessageSender`, register pending request in `RequestRegistry`, return a `Promise<RequestResult>` that resolves when the user replies or timeout elapses; on timeout edit the Telegram message to show expiry
    - Implement `shutdown()` — stop polling, resolve all pending requests as `timed_out`, clear registry
    - _Requirements: 1.1, 1.3, 2.1, 2.4, 2.5, 3.1, 3.3, 4.2, 4.3, 7.1_

  - [x] 6.2 Write unit tests for IntegrationService
    - Test end-to-end flow: send confirmation → receive approve callback → resolve with approved status (mock Telegram API)
    - Test end-to-end flow: send information request → receive text reply → resolve with answered status
    - Test timeout flow: send request → timeout elapses → resolve with timed_out, message edited
    - _Requirements: 2.4, 2.5, 3.3, 4.2, 4.3_

- [x] 7. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement MCP Server Adapter
  - [x] 8.1 Implement `src/mcp/tools.ts`
    - Define MCP tool schemas for `telegram_confirm`, `telegram_ask`, `telegram_notify`, `telegram_status`
    - Each tool delegates to the corresponding `IntegrationService` method
    - _Requirements: 2.1, 3.1_

  - [x] 8.2 Implement `src/mcp/server.ts`
    - Create MCP server entry point using `@modelcontextprotocol/sdk`
    - Read `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` from `process.env`
    - Build config via `ConfigManager.fromRecord(process.env)`, validate, initialize `IntegrationService`
    - Register all tools from `tools.ts`
    - Use stdio transport
    - Handle missing env vars: log error and exit with non-zero code
    - Add `#!/usr/bin/env node` shebang for `npx` execution
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 8.3 Write unit tests for MCP adapter
    - Test tool registration (all 4 tools registered with correct schemas)
    - Test config loading from `process.env`
    - Test error response when env vars are missing
    - _Requirements: 1.1, 1.2_

- [x] 9. Implement VS Code Extension Adapter
  - [x] 9.1 Implement `src/extension/extension.ts`
    - Implement `activate()` — read config from VS Code settings API (`kiroTelegram.botToken`, `kiroTelegram.chatId`, `kiroTelegram.timeoutMinutes`), build config via `ConfigManager.fromRecord()`, initialize `IntegrationService`
    - Implement `deactivate()` — call `IntegrationService.shutdown()`
    - Show notification with link to settings if config is missing
    - _Requirements: 1.1, 1.2, 9.1_

  - [x] 9.2 Implement `src/extension/commands.ts`
    - Register commands: `kiroTelegram.configure` (open settings), `kiroTelegram.testConnection` (verify connectivity), `kiroTelegram.status` (show connection status notification)
    - _Requirements: 1.3, 1.4_

  - [x] 9.3 Implement `src/extension/statusBar.ts`
    - Create status bar item showing connection status (✓ connected, ✗ disconnected)
    - Show pending request count when > 0
    - Click opens command palette with `kiroTelegram` commands
    - _Requirements: 7.1_

  - [x] 9.4 Write unit tests for VS Code extension adapter
    - Test config loading from VS Code settings API
    - Test command registration
    - Test status bar updates on connection state changes
    - _Requirements: 1.1, 9.1_

- [x] 10. Add LICENSE file and documentation
  - [x] 10.1 Create `LICENSE` file with full MIT License text in the repository root
    - _Requirements: 11.1, 11.2_

  - [x] 10.2 Add inline code comments to all exported functions across `src/core/`, `src/mcp/`, and `src/extension/`
    - Each exported function must have JSDoc describing purpose, parameters, and return value
    - _Requirements: 10.1_

  - [x] 10.3 Create `README.md` with quick-start guide, architecture overview, configuration options, message types, timeout behavior, troubleshooting, security considerations, and license reference
    - Include BotFather setup steps, Node.js version requirement, dependency installation
    - Cover Bot_Token storage, Chat_ID validation, data-in-transit encryption, recommended Telegram privacy settings
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6, 11.3_

- [x] 11. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The core library is built first, then adapters, ensuring no orphaned code
