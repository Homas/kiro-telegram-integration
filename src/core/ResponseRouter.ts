import type { TelegramConfig, TelegramUpdate, RoutingResult } from './types.js';
import type { RequestRegistry } from './RequestRegistry.js';
import type { MessageSender } from './MessageSender.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Parse callback data encoded as `{requestId}:{action}`.
 *
 * Splits on the last colon so that request IDs containing colons are handled
 * correctly.
 *
 * @param data - The raw callback data string from a Telegram callback query.
 * @returns The parsed request ID and action, or `null` if the format is invalid.
 */
export function parseCallbackData(data: string): { requestId: string; action: string } | null {
  const lastColon = data.lastIndexOf(':');
  if (lastColon <= 0 || lastColon === data.length - 1) {
    return null;
  }
  return {
    requestId: data.slice(0, lastColon),
    action: data.slice(lastColon + 1),
  };
}

/**
 * Encode a request ID and action into callback data format `{requestId}:{action}`.
 *
 * @param requestId - The unique request identifier.
 * @param action - The action string (e.g. "approve" or "cancel").
 * @returns The encoded callback data string.
 */
export function encodeCallbackData(requestId: string, action: string): string {
  return `${requestId}:${action}`;
}

/**
 * ResponseRouter matches incoming Telegram updates to pending requests.
 *
 * For callback queries (button taps), it parses the callback data to extract
 * the request ID and action, then resolves the corresponding pending request.
 * For text replies, it matches the `reply_to_message.message_id` to a pending
 * information request's `messageId`.
 *
 * If no matching pending request is found, or if the request has already been
 * resolved/expired, the router sends an appropriate notification to the user.
 */
export class ResponseRouter {
  private readonly registry: RequestRegistry;
  private readonly sender: MessageSender;
  private readonly config: TelegramConfig;

  /**
   * Create a new ResponseRouter.
   *
   * @param registry - The request registry for looking up pending requests.
   * @param sender - The message sender for sending notifications.
   * @param config - The Telegram configuration including bot token.
   */
  constructor(registry: RequestRegistry, sender: MessageSender, config: TelegramConfig) {
    this.registry = registry;
    this.sender = sender;
    this.config = config;
  }

  /**
   * Process an incoming Telegram update and route it to the correct pending request.
   *
   * - Callback queries: parsed as `{requestId}:{action}`, resolved as approved/cancelled.
   * - Text replies: matched by `reply_to_message.message_id` to a pending information request.
   * - Unmatched updates: a notification is sent to the user.
   * - Expired/resolved requests: an expiry notification is sent to the user.
   *
   * @param update - The incoming Telegram update to process.
   * @returns The routing result indicating whether a match was found.
   */
  async routeUpdate(update: TelegramUpdate): Promise<RoutingResult> {
    if (update.callback_query) {
      return this.handleCallbackQuery(update);
    }

    if (update.message?.reply_to_message) {
      return this.handleTextReply(update);
    }

    return { matched: false, error: 'Update contains neither callback query nor reply message' };
  }

  /**
   * Handle a callback query from an inline keyboard button tap.
   */
  private async handleCallbackQuery(update: TelegramUpdate): Promise<RoutingResult> {
    const callbackQuery = update.callback_query!;
    const parsed = parseCallbackData(callbackQuery.data);

    if (!parsed) {
      return { matched: false, error: 'Invalid callback data format' };
    }

    const { requestId, action } = parsed;

    // Always acknowledge the callback query to remove the loading indicator
    await this.answerCallbackQuery(callbackQuery.id);

    // Check if the request is still pending
    if (!this.registry.isPending(requestId)) {
      // Request was already resolved or expired
      await this.sender.sendNotification(
        '⏰ This request has already expired or been resolved.',
      );
      return { matched: false, requestId, error: 'Request already resolved or expired' };
    }

    const status = action === 'approve' ? 'approved' as const : 'cancelled' as const;
    this.registry.resolve(requestId, { requestId, status });

    return { matched: true, requestId };
  }

  /**
   * Handle a text reply to an information request message.
   */
  private async handleTextReply(update: TelegramUpdate): Promise<RoutingResult> {
    const message = update.message!;
    const replyToMessageId = message.reply_to_message!.message_id;
    const replyText = message.text ?? '';

    // Find the pending request by the message ID it was sent as
    const request = this.registry.findByMessageId(replyToMessageId);

    if (!request) {
      // No matching pending request — could be expired or never existed
      await this.sender.sendNotification(
        '⚠️ No matching pending request found for this reply.',
      );
      return { matched: false, error: 'No matching pending request found' };
    }

    if (!this.registry.isPending(request.id)) {
      // Request exists but is no longer pending (already resolved/expired)
      await this.sender.sendNotification(
        '⏰ This request has already expired or been resolved.',
      );
      return { matched: false, requestId: request.id, error: 'Request already resolved or expired' };
    }

    this.registry.resolve(request.id, {
      requestId: request.id,
      status: 'answered',
      data: replyText,
    });

    return { matched: true, requestId: request.id };
  }

  /**
   * Acknowledge a callback query via the Telegram answerCallbackQuery API.
   *
   * This removes the loading indicator on the user's Telegram client.
   *
   * @param callbackQueryId - The ID of the callback query to acknowledge.
   */
  private async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    const url = `${TELEGRAM_API_BASE}/bot${this.config.botToken}/answerCallbackQuery`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId }),
      });
    } catch {
      // Best-effort acknowledgment — don't fail the routing if this fails
    }
  }
}
