import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Conversation, Cursor, EntryId } from "@earendil-works/pi-durable";

const PAGE_SIZE = 200;

/**
 * Streams the conversation's full history to the server, oldest first, independent of Pi Durable
 * compaction and resets (§3.4). `Conversation.entries` is the fork-aware history, so entries the
 * active transcript no longer shows are still mirrored.
 *
 * Sending is idempotent: the server upserts by entry id, so a restart that re-reads from the start
 * cannot duplicate rows.
 */
export class EntryPump {
  #cursor: Cursor | undefined;
  #lastSent: EntryId | undefined;

  constructor(
    private readonly conversation: Conversation,
    private readonly send: (entry: unknown) => void,
  ) {}

  /** Send every entry not yet sent. Safe to call after every commit. */
  async drain(): Promise<void> {
    for (;;) {
      const page = await this.conversation.entries(
        { order: "ascending" },
        PAGE_SIZE,
        this.#cursor,
        BACKGROUND_CONTEXT,
      );
      for (const entry of page.items) {
        if (entry.id === this.#lastSent) continue;
        this.send(entry);
        this.#lastSent = entry.id;
      }
      if (page.next === undefined) return;
      this.#cursor = page.next;
    }
  }
}
