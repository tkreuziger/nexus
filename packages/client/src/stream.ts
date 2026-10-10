import { ApiError, errorFromResponse, StreamUnavailableError } from "./errors.ts";
import type { StreamFrame } from "./wire.ts";

/**
 * Split a server-sent event byte stream into frames.
 *
 * The server writes exactly `data: <json>\n\n` per frame. Frames are accumulated rather than assumed
 * whole, because a network chunk routinely splits one. A frame that is not a JSON object with a string
 * `type` is dropped rather than thrown: the stream is long-lived, and one bad frame must not tear down
 * the view. `onMalformed` reports them for logging.
 */
export class SseParser {
  #buffer = "";
  readonly #onMalformed: ((raw: string) => void) | undefined;

  constructor(options: { onMalformed?: (raw: string) => void } = {}) {
    this.#onMalformed = options.onMalformed;
  }

  /** Append a chunk and return every frame it completed. */
  push(chunk: string): StreamFrame[] {
    // A bare `\r` is a line terminator in the SSE grammar, and JSON escapes its own control
    // characters, so dropping carriage returns cannot corrupt a payload — but it does make the
    // `\n\n` frame boundary detectable even when a chunk splits a CRLF pair.
    this.#buffer += chunk.replaceAll("\r", "");
    const frames: StreamFrame[] = [];
    for (;;) {
      const boundary = this.#buffer.indexOf("\n\n");
      if (boundary === -1) return frames;
      const raw = this.#buffer.slice(0, boundary);
      this.#buffer = this.#buffer.slice(boundary + 2);
      const frame = this.#parse(raw);
      if (frame !== undefined) frames.push(frame);
    }
  }

  #parse(raw: string): StreamFrame | undefined {
    const data: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith(":")) continue; // comment, or a keep-alive
      if (line.startsWith("data:")) data.push(line.slice("data:".length).trimStart());
    }
    if (data.length === 0) return undefined;
    try {
      const parsed: unknown = JSON.parse(data.join("\n"));
      if (typeof parsed === "object" && parsed !== null) {
        const { type } = parsed as { type?: unknown };
        if (typeof type === "string") return parsed as StreamFrame;
      }
    } catch {
      // Reported below.
    }
    this.#onMalformed?.(raw);
    return undefined;
  }
}

export interface StreamOptions {
  /** Prefix for every request; `""` (the default) means same origin. */
  baseUrl?: string;
  token?: string | null;
  signal?: AbortSignal;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

function streamInit(options: StreamOptions): RequestInit {
  const headers: Record<string, string> = { accept: "text/event-stream" };
  if (options.token !== undefined && options.token !== null) {
    headers.authorization = `Bearer ${options.token}`;
  }
  const init: RequestInit = { method: "GET", headers };
  if (options.signal !== undefined) init.signal = options.signal;
  return init;
}

export function sessionEventsUrl(sessionId: string, baseUrl = ""): string {
  return `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/events`;
}

/**
 * Read one connection to a session's event stream, yielding frames until the connection ends.
 * Throws `StreamUnavailableError` when the session has no running process (409).
 */
export async function* readEventStream(
  sessionId: string,
  options: StreamOptions = {},
): AsyncGenerator<StreamFrame> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const response = await doFetch(sessionEventsUrl(sessionId, options.baseUrl), streamInit(options));
  if (response.status === 409) throw new StreamUnavailableError();
  if (!response.ok) throw await errorFromResponse(response);
  if (response.body === null) throw new ApiError(0, "event stream response has no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      for (const frame of parser.push(decoder.decode(value, { stream: true }))) yield frame;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export type StreamState = "connecting" | "open" | "unavailable" | "reconnecting" | "closed";

/** Delays between reconnects, in milliseconds; the last value repeats. */
export const DEFAULT_BACKOFF: readonly number[] = [500, 1_000, 2_000, 4_000, 8_000, 10_000];

export interface SessionStreamOptions extends StreamOptions {
  onFrame: (frame: StreamFrame) => void;
  onState?: (state: StreamState, detail?: string) => void;
  backoff?: readonly number[];
}

const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

/**
 * A self-healing attachment to one session's event stream. It reconnects with backoff on a dropped
 * connection, and keeps retrying slowly when the session is not running, so restarting a crashed
 * session re-attaches without the UI having to notice.
 */
export class SessionStream {
  readonly #sessionId: string;
  readonly #options: SessionStreamOptions;
  #controller: AbortController | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;
  #stopped = true;
  #state: StreamState = "closed";

  constructor(sessionId: string, options: SessionStreamOptions) {
    this.#sessionId = sessionId;
    this.#options = options;
  }

  get state(): StreamState {
    return this.#state;
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#attempt = 0;
    void this.#connect();
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#controller?.abort();
    this.#controller = undefined;
    this.#setState("closed");
  }

  async #connect(): Promise<void> {
    if (this.#stopped) return;
    this.#setState(this.#attempt === 0 ? "connecting" : "reconnecting");
    const controller = new AbortController();
    this.#controller = controller;
    let opened = false;
    try {
      const stream = readEventStream(this.#sessionId, {
        ...this.#options,
        signal: controller.signal,
      });
      for await (const frame of stream) {
        if (this.#stopped) return;
        if (!opened) {
          opened = true;
          this.#attempt = 0;
          this.#setState("open");
        }
        this.#options.onFrame(frame);
      }
      if (!this.#stopped) this.#retry();
    } catch (error) {
      if (this.#stopped || isAbort(error)) return;
      if (error instanceof StreamUnavailableError) {
        this.#setState("unavailable");
        this.#retry();
        return;
      }
      this.#setState("reconnecting", error instanceof Error ? error.message : String(error));
      this.#retry();
    }
  }

  #retry(): void {
    if (this.#stopped) return;
    const schedule = this.#options.backoff ?? DEFAULT_BACKOFF;
    const delay = schedule[Math.min(this.#attempt, schedule.length - 1)] ?? 1_000;
    this.#attempt += 1;
    this.#timer = setTimeout(() => void this.#connect(), delay);
  }

  #setState(state: StreamState, detail?: string): void {
    if (this.#state === state && detail === undefined) return;
    this.#state = state;
    this.#options.onState?.(state, detail);
  }
}
