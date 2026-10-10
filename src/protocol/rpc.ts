/** Direction-agnostic JSON-RPC over a line-oriented duplex channel (ADR-1). */

export interface FrameChannel {
  lines: AsyncIterable<string>;
  write(text: string): void;
}

type RequestHandler = (params: unknown) => unknown | Promise<unknown>;
type NotificationHandler = (params: unknown) => void;

interface Frame {
  id?: number;
  method?: string;
  params?: unknown;
  ok?: boolean;
  result?: unknown;
  error?: string;
}

function parseFrame(line: string): Frame | undefined {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Frame;
  } catch {
    return undefined;
  }
}

/**
 * Correlates responses with requests by id, dispatches incoming requests and notifications, and
 * rejects in-flight work when the channel ends.
 */
export class JsonRpc {
  #nextId = 1;
  readonly #pending = new Map<
    number,
    { resolve: (value: never) => void; reject: (error: Error) => void }
  >();
  readonly #requests = new Map<string, RequestHandler>();
  readonly #notifications = new Map<string, NotificationHandler>();
  readonly #closeHandlers: (() => void)[] = [];
  #closed = false;

  constructor(private readonly channel: FrameChannel) {}

  /** Begin consuming the channel. Incoming frames are handled in order. */
  start(): void {
    void this.#read();
  }

  request<T>(method: string, params: unknown): Promise<T> {
    const id = this.#nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    this.#pending.set(id, { resolve: resolve as (value: never) => void, reject });
    this.channel.write(`${JSON.stringify({ id, method, params })}\n`);
    return promise;
  }

  notify(method: string, params: unknown): void {
    this.channel.write(`${JSON.stringify({ method, params })}\n`);
  }

  onRequest(method: string, handler: RequestHandler): void {
    this.#requests.set(method, handler);
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.#notifications.set(method, handler);
  }

  onClose(handler: () => void): void {
    this.#closeHandlers.push(handler);
  }

  close(): void {
    this.#shutdown();
  }

  async #read(): Promise<void> {
    try {
      for await (const line of this.channel.lines) {
        const frame = parseFrame(line);
        if (frame !== undefined) await this.#handle(frame);
      }
    } catch (error) {
      console.error("ipc: read failed", error);
    }
    this.#shutdown();
  }

  async #handle(frame: Frame): Promise<void> {
    if (frame.id !== undefined && frame.ok !== undefined) {
      this.#settle(frame);
      return;
    }
    if (frame.id !== undefined && frame.method !== undefined) {
      await this.#answer(frame.id, frame.method, frame.params);
      return;
    }
    if (frame.method !== undefined) {
      this.#notifications.get(frame.method)?.(frame.params);
    }
  }

  #settle(frame: Frame): void {
    const waiter = this.#pending.get(frame.id as number);
    if (waiter === undefined) return;
    this.#pending.delete(frame.id as number);
    if (frame.ok === true) waiter.resolve(frame.result as never);
    else waiter.reject(new Error(frame.error ?? "remote error"));
  }

  async #answer(id: number, method: string, params: unknown): Promise<void> {
    const handler = this.#requests.get(method);
    if (handler === undefined) {
      this.channel.write(
        `${JSON.stringify({ id, ok: false, error: `unknown method: ${method}` })}\n`,
      );
      return;
    }
    try {
      const result = await handler(params);
      this.channel.write(`${JSON.stringify({ id, ok: true, result: result ?? null })}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.channel.write(`${JSON.stringify({ id, ok: false, error: message })}\n`);
    }
  }

  #shutdown(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const waiter of this.#pending.values()) {
      waiter.reject(new Error("connection closed"));
    }
    this.#pending.clear();
    for (const handler of this.#closeHandlers) handler();
  }
}
