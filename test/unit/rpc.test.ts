import { describe, expect, test } from "bun:test";
import { type FrameChannel, JsonRpc } from "../../src/protocol/rpc.ts";

interface Fake {
  channel: FrameChannel;
  written: () => Record<string, unknown>[];
  push: (frame: unknown) => void;
  pushRaw: (text: string) => void;
  end: () => void;
  nextWrite: () => Promise<void>;
}

function fakeChannel(): Fake {
  let controller: ReadableStreamDefaultController<string>;
  const stream = new ReadableStream<string>({
    start(created) {
      controller = created;
    },
  });
  const written: string[] = [];
  let pendingWrite = Promise.withResolvers<void>();
  return {
    channel: {
      lines: stream,
      write: (text) => {
        written.push(text);
        pendingWrite.resolve();
        pendingWrite = Promise.withResolvers<void>();
      },
    },
    written: () => written.map((line) => JSON.parse(line) as Record<string, unknown>),
    push: (frame) => controller.enqueue(`${JSON.stringify(frame)}\n`),
    pushRaw: (text) => controller.enqueue(text),
    end: () => controller.close(),
    nextWrite: () => pendingWrite.promise,
  };
}

/** Push a frame and wait until `condition` holds, so tests never guess a duration. */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Promise.withResolvers<void>();
  const poll = () => (condition() ? deadline.resolve() : setImmediate(poll));
  setImmediate(poll);
  await deadline.promise;
}

describe("JsonRpc", () => {
  test("resolves a request with the matching response result", async () => {
    const fake = fakeChannel();
    const rpc = new JsonRpc(fake.channel);
    rpc.start();
    const written = fake.nextWrite();
    const pending = rpc.request<{ value: number }>("echo", { n: 1 });
    await written;
    const sent = fake.written()[0] as { id: number };
    fake.push({ id: sent.id, ok: true, result: { value: 42 } });
    expect(await pending).toEqual({ value: 42 });
  });

  test("routes concurrent responses to their own requests", async () => {
    const fake = fakeChannel();
    const rpc = new JsonRpc(fake.channel);
    rpc.start();
    const first = rpc.request<string>("a", {});
    const second = rpc.request<string>("b", {});
    await until(() => fake.written().length === 2);
    const [one, two] = fake.written() as { id: number }[];
    if (one === undefined || two === undefined) throw new Error("expected two frames");
    fake.push({ id: two.id, ok: true, result: "second" });
    fake.push({ id: one.id, ok: true, result: "first" });
    expect(await first).toBe("first");
    expect(await second).toBe("second");
  });

  test("rejects a request when the response reports an error", async () => {
    const fake = fakeChannel();
    const rpc = new JsonRpc(fake.channel);
    rpc.start();
    const written = fake.nextWrite();
    const pending = rpc.request("boom", {});
    await written;
    const sent = fake.written()[0] as { id: number };
    fake.push({ id: sent.id, ok: false, error: "it broke" });
    await expect(pending).rejects.toThrow("it broke");
  });

  test("dispatches a notification to its handler", async () => {
    const fake = fakeChannel();
    const rpc = new JsonRpc(fake.channel);
    const seen: unknown[] = [];
    const handled = Promise.withResolvers<void>();
    rpc.onNotification("hello", (params) => {
      seen.push(params);
      handled.resolve();
    });
    rpc.start();
    fake.push({ method: "hello", params: { text: "hi" } });
    await handled.promise;
    expect(seen).toEqual([{ text: "hi" }]);
  });

  test("answers an incoming request with the handler's result", async () => {
    const fake = fakeChannel();
    const rpc = new JsonRpc(fake.channel);
    rpc.onRequest("add", (params) => {
      const { a, b } = params as { a: number; b: number };
      return a + b;
    });
    rpc.start();
    const written = fake.nextWrite();
    fake.push({ id: 7, method: "add", params: { a: 2, b: 3 } });
    await written;
    expect(fake.written()[0]).toEqual({ id: 7, ok: true, result: 5 });
  });

  test("answers an incoming request with an error when the handler throws", async () => {
    const fake = fakeChannel();
    const rpc = new JsonRpc(fake.channel);
    rpc.onRequest("fail", () => {
      throw new Error("nope");
    });
    rpc.start();
    const written = fake.nextWrite();
    fake.push({ id: 9, method: "fail", params: {} });
    await written;
    expect(fake.written()[0]).toEqual({ id: 9, ok: false, error: "nope" });
  });

  test("reports an unknown method as an error response", async () => {
    const fake = fakeChannel();
    const rpc = new JsonRpc(fake.channel);
    rpc.start();
    const written = fake.nextWrite();
    fake.push({ id: 3, method: "mystery", params: {} });
    await written;
    expect(fake.written()[0]).toEqual({ id: 3, ok: false, error: "unknown method: mystery" });
  });

  test("notifies close when the line stream ends", async () => {
    const fake = fakeChannel();
    const rpc = new JsonRpc(fake.channel);
    const closed = Promise.withResolvers<void>();
    rpc.onClose(() => closed.resolve());
    rpc.start();
    fake.end();
    await closed.promise;
    expect(true).toBe(true);
  });

  test("rejects in-flight requests when the stream ends", async () => {
    const fake = fakeChannel();
    const rpc = new JsonRpc(fake.channel);
    rpc.start();
    const written = fake.nextWrite();
    const pending = rpc.request("never-answered", {});
    await written;
    fake.end();
    await expect(pending).rejects.toThrow("connection closed");
  });

  test("ignores malformed frames instead of crashing", async () => {
    const fake = fakeChannel();
    const rpc = new JsonRpc(fake.channel);
    const seen: unknown[] = [];
    const handled = Promise.withResolvers<void>();
    rpc.onNotification("ok", (params) => {
      seen.push(params);
      handled.resolve();
    });
    rpc.start();
    fake.pushRaw("not json\n");
    fake.push({ method: "ok", params: 1 });
    await handled.promise;
    expect(seen).toEqual([1]);
  });

  test("lets a request handler issue its own request without deadlocking", async () => {
    const fake = fakeChannel();
    const rpc = new JsonRpc(fake.channel);
    rpc.onRequest("outer", async () => ({ inner: await rpc.request("inner", {}) }));
    rpc.start();
    fake.push({ id: 99, method: "outer", params: {} });
    await until(() => fake.written().some((frame) => frame.method === "inner"));
    const inner = fake.written().find((frame) => frame.method === "inner") as { id: number };
    fake.push({ id: inner.id, ok: true, result: "pong" });
    await until(() => fake.written().some((frame) => frame.id === 99));
    expect(fake.written().find((frame) => frame.id === 99)).toEqual({
      id: 99,
      ok: true,
      result: { inner: "pong" },
    });
  });
});
