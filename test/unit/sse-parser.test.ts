import { describe, expect, test } from "bun:test";
import type { FetchLike, SessionStatus, StreamFrame } from "@nexus/client";
import { readEventStream, SessionStream, SseParser } from "@nexus/client";

const frame = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`;
const status = (value: SessionStatus): StreamFrame => ({ type: "session_status", status: value });
const runStart: StreamFrame = { type: "run_start", inputs: [] };
const turnStart: StreamFrame = { type: "turn_start" };

describe("SseParser", () => {
  test("parses one complete frame", () => {
    const parser = new SseParser();
    expect(parser.push(frame({ type: "session_status", status: "idle" }))).toEqual([
      status("idle"),
    ]);
  });

  test("parses several frames from one chunk", () => {
    const parser = new SseParser();
    const frames = parser.push(
      frame({ type: "session_status", status: "running" }) + frame({ type: "turn_start" }),
    );
    expect(frames.map((f) => f.type)).toEqual(["session_status", "turn_start"]);
  });

  test("holds a frame that a chunk boundary splits", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"type":"session_st')).toEqual([]);
    expect(parser.push('atus","status":"idle"}\n\n')).toEqual([status("idle")]);
  });

  test("emits the complete frames and keeps the partial remainder", () => {
    const parser = new SseParser();
    const chunk = frame({ type: "turn_start" }) + frame({ type: "run_start", inputs: [] });
    const split = chunk.indexOf('"inputs"');
    expect(parser.push(chunk.slice(0, split)).map((f) => f.type)).toEqual(["turn_start"]);
    expect(parser.push(chunk.slice(split))).toEqual([runStart]);
  });

  test("accepts CRLF line endings", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"type":"turn_start"}\r\n\r\n')).toEqual([
      { type: "turn_start" } as StreamFrame,
    ]);
  });

  test("accepts a CRLF pair split across two chunks", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"type":"turn_start"}\r')).toEqual([]);
    expect(parser.push("\n\r\n")).toEqual([turnStart]);
  });

  test("ignores comments and keep-alives", () => {
    const parser = new SseParser();
    expect(parser.push(": keep-alive\n\n")).toEqual([]);
    expect(parser.push("data: \n\n")).toEqual([]);
  });

  test("joins multi-line data before parsing", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"type":\ndata: "turn_start"}\n\n')).toEqual([
      { type: "turn_start" } as StreamFrame,
    ]);
  });

  test("drops a malformed frame and reports it, without losing the next one", () => {
    const seen: string[] = [];
    const parser = new SseParser({ onMalformed: (raw) => seen.push(raw) });
    const frames = parser.push(`data: {not json\n\n${frame({ type: "turn_start" })}`);
    expect(frames.map((f) => f.type)).toEqual(["turn_start"]);
    expect(seen).toEqual(["data: {not json"]);
  });

  test("drops payloads that are not objects with a string type", () => {
    const parser = new SseParser();
    expect(parser.push("data: 42\n\n")).toEqual([]);
    expect(parser.push('data: {"status":"idle"}\n\n')).toEqual([]);
    expect(parser.push('data: {"type":7}\n\n')).toEqual([]);
  });
});

const streamOf = (chunks: readonly string[]): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

const fetchOf = (response: Response): FetchLike => (async () => response) as unknown as FetchLike;

describe("readEventStream", () => {
  test("yields frames across chunk boundaries and stops at the end", async () => {
    const body = [
      frame({ type: "session_status", status: "running" }),
      frame({ type: "turn_start" }),
      frame({ type: "run_end", inputs: [] }),
    ].join("");
    const half = Math.floor(body.length / 2);
    const frames: StreamFrame[] = [];
    for await (const item of readEventStream("s1", {
      fetch: fetchOf(streamOf([body.slice(0, half), body.slice(half)])),
    })) {
      frames.push(item);
    }
    expect(frames.map((f) => f.type)).toEqual(["session_status", "turn_start", "run_end"]);
  });

  test("raises StreamUnavailableError on 409", async () => {
    const fetch = fetchOf(
      new Response('{"error":{"message":"session is not running"}}', { status: 409 }),
    );
    const iterate = async () => {
      for await (const _ of readEventStream("s1", { fetch })) {
        // No frames expected.
      }
    };
    await expect(iterate()).rejects.toMatchObject({
      name: "StreamUnavailableError",
      status: 409,
    });
  });

  test("sends the bearer token and the accept header", async () => {
    let seen: RequestInit | undefined;
    const fakeFetch = (async (_input: string, init?: RequestInit): Promise<Response> => {
      seen = init;
      return streamOf([frame({ type: "turn_start" })]);
    }) as unknown as FetchLike;
    for await (const _ of readEventStream("s1", { token: "nx_t_s", fetch: fakeFetch })) {
      // Drain.
    }
    const headers = seen?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer nx_t_s");
    expect(headers.accept).toBe("text/event-stream");
  });
});

describe("SessionStream", () => {
  test("reports unavailable and keeps retrying while the session is not running", async () => {
    const states: string[] = [];
    const fetch = fetchOf(new Response("{}", { status: 409 }));
    const stream = new SessionStream("s1", {
      fetch,
      backoff: [5],
      onFrame: () => undefined,
      onState: (state) => states.push(state),
    });
    stream.start();
    await Bun.sleep(40);
    stream.stop();
    expect(states[0]).toBe("connecting");
    expect(states).toContain("unavailable");
    expect(states.at(-1)).toBe("closed");
  });

  test("delivers frames and reports open", async () => {
    const frames: StreamFrame[] = [];
    const states: string[] = [];
    const fetch = fetchOf(streamOf([frame({ type: "session_status", status: "idle" })]));
    const stream = new SessionStream("s1", {
      fetch,
      backoff: [5],
      onFrame: (item) => frames.push(item),
      onState: (state) => states.push(state),
    });
    stream.start();
    await Bun.sleep(30);
    stream.stop();
    expect(frames.map((f) => f.type)).toEqual(["session_status"]);
    expect(states).toContain("open");
  });
});
