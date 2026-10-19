import type { SessionDetail, UiMessage } from "@pi-desktop/shared";
import { TRANSCRIPT_CONTENT_LIMIT } from "./transcript-reading";

/** A bounded history read, shaped like `api.getSession(sessionId, options)`. */
export type ConversationPageReader = (options: {
  messageBefore?: number;
  messageLimit: number;
  contentLimit: number;
  topLevelOnly: true;
}) => Promise<{ session?: SessionDetail | null }>;

/** The host caps one window at this many messages. */
export const CONVERSATION_READ_PAGE_SIZE = 1000;

/**
 * Read a whole conversation as bounded pages, oldest first.
 *
 * An explicit "copy conversation" is the one renderer action that wants every
 * message, and it used to ask the host for the whole transcript in one reply —
 * a reply a long session cannot deliver to the renderer without killing it.
 * This walks the same paged read the transcript itself uses, newest page
 * first, so no single reply exceeds a page, and every message is the display
 * copy: a tool payload beyond `contentLimit` carries the host's truncation
 * marker rather than its full bytes. Returns null when the session is gone.
 */
export async function readConversationPages(
  read: ConversationPageReader,
  options: { pageSize?: number; contentLimit?: number } = {},
): Promise<UiMessage[] | null> {
  const pageSize = options.pageSize ?? CONVERSATION_READ_PAGE_SIZE;
  const contentLimit = options.contentLimit ?? TRANSCRIPT_CONTENT_LIMIT;
  const pages: UiMessage[][] = [];
  let cursor: number | undefined;
  for (;;) {
    const { session } = await read({
      ...(cursor !== undefined ? { messageBefore: cursor } : {}),
      messageLimit: pageSize,
      contentLimit,
      // The conversation is its top-level rows; a delegate's rows are not part
      // of what is copied, and they are the bulk of a long session's bytes.
      topLevelOnly: true,
    });
    if (!session) return pages.length ? pages.flat() : null;
    pages.unshift(session.messages ?? []);
    const start = session.messageStart ?? 0;
    // A page that reports more history but no earlier offset cannot be
    // followed; stop rather than loop on the same page.
    if (session.hasMoreBefore !== true || start <= 0 || (cursor !== undefined && start >= cursor)) {
      break;
    }
    cursor = start;
  }
  return pages.flat();
}
