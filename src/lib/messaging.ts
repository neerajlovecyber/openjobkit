// Type-safe message passing between extension contexts
// Wraps browser.runtime.sendMessage and browser.tabs.sendMessage
// with full TypeScript discriminated-union support.

import type { ExtensionMessage } from '@/types/messages'

// ────────────────────────────────────────────────────────────────────────────
// Send helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Send a message to the background service worker from any context.
 * Returns a typed response if the background replies.
 */
export async function sendToBackground<R = void>(
  message: ExtensionMessage,
): Promise<R> {
  return browser.runtime.sendMessage(message) as Promise<R>
}

/**
 * Send a message to a specific tab's content script (called from background).
 */
export async function sendToTab<R = void>(
  tabId: number,
  message: ExtensionMessage,
): Promise<R> {
  return browser.tabs.sendMessage(tabId, message) as Promise<R>
}

// ────────────────────────────────────────────────────────────────────────────
// Listener helpers
// ────────────────────────────────────────────────────────────────────────────

type MessageHandler<T extends ExtensionMessage> = (
  message: T,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sender: any,
) => unknown

type MessageHandlerMap = {
  [K in ExtensionMessage['type']]?: MessageHandler<
    Extract<ExtensionMessage, { type: K }>
  >
}

/**
 * Register typed message handlers.
 * Usage:
 *
 *   onMessage({
 *     DETECT_JOB: async (msg, sender) => { ... },
 *     FILL_JOB:   async (msg, sender) => { ... },
 *   })
 */
export function onMessage(handlers: MessageHandlerMap): () => void {
  const listener = (
    message: ExtensionMessage,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sender: any,
    sendResponse: (response?: unknown) => void,
  ) => {
    const handler = handlers[message.type] as
      | MessageHandler<typeof message>
      | undefined
    if (!handler) return false

    const result = handler(message, sender)
    if (result instanceof Promise) {
      result.then(sendResponse).catch((err) => {
        console.error(
          `[OpenJobKit] Message handler error for "${message.type}":`,
          err,
        )
        sendResponse({ error: String(err) })
      })
      return true // Keep channel open for async response
    }

    sendResponse(result)
    return false
  }

  browser.runtime.onMessage.addListener(listener)

  // Return a cleanup function
  return () => browser.runtime.onMessage.removeListener(listener)
}
