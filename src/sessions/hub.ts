import type { SessionStatus } from "../types.ts";

type Listener = (event: unknown) => void;

/**
 * Fan-out for one session: status changes to every attached client, and each client's own Pi Durable
 * event stream routed by subscription id (§3.4).
 */
export class SessionHub {
  #status: SessionStatus;
  readonly #statusListeners = new Set<Listener>();
  readonly #eventListeners = new Map<string, (events: readonly unknown[]) => void>();

  constructor(status: SessionStatus) {
    this.#status = status;
  }

  get status(): SessionStatus {
    return this.#status;
  }

  set status(status: SessionStatus) {
    this.#status = status;
    this.#broadcastStatus();
  }

  /** Attach a status listener, delivering the current status in the same synchronous step. */
  subscribeStatus(listener: Listener): () => void {
    this.#statusListeners.add(listener);
    listener({ type: "session_status", status: this.#status });
    return () => this.#statusListeners.delete(listener);
  }

  addSubscription(id: string, listener: (events: readonly unknown[]) => void): void {
    this.#eventListeners.set(id, listener);
  }

  removeSubscription(id: string): void {
    this.#eventListeners.delete(id);
  }

  /** Deliver one subscription's event batch. */
  publish(id: string, events: readonly unknown[]): void {
    this.#eventListeners.get(id)?.(events);
  }

  #broadcastStatus(): void {
    for (const listener of this.#statusListeners) {
      listener({ type: "session_status", status: this.#status });
    }
  }
}
