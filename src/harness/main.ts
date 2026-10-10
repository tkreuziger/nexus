import { createInterface } from "node:readline";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type AgentEventStream, watchEvents } from "@earendil-works/pi-durable";
import {
  asConfigureParams,
  asInitParams,
  asSubmitParams,
  asSubscribeParams,
  asUnsubscribeParams,
} from "../protocol/guards.ts";
import { HARNESS_METHODS, SERVER_METHODS } from "../protocol/messages.ts";
import { type FrameChannel, JsonRpc } from "../protocol/rpc.ts";
import { createProxyCredentialStore } from "./credentials.ts";
import { EntryPump } from "./entries.ts";
import { openSessionRuntime, type SessionRuntime } from "./runtime.ts";

// stdout carries protocol frames only (ADR-1), so anything the runtime logs must go to stderr.
console.log = (...args: unknown[]) => console.error(...args);

const stdioChannel = (): FrameChannel => ({
  lines: createInterface({ input: process.stdin }),
  write: (text) => process.stdout.write(text),
});

const eventType = (event: unknown): string | undefined =>
  event !== null && typeof event === "object" && "type" in event && typeof event.type === "string"
    ? event.type
    : undefined;

const rpc = new JsonRpc(stdioChannel());

interface OpenSession {
  runtime: SessionRuntime;
  pump: EntryPump;
  /** One Pi Durable attachment per subscribed client, plus the internal one that drives the mirror. */
  streams: Map<string, AgentEventStream>;
}

let session: OpenSession | undefined;

function requireSession(): OpenSession {
  if (session === undefined) throw new Error("harness received a request before init");
  return session;
}

async function attach(session: OpenSession, subscriptionId: string): Promise<void> {
  const stream = await watchEvents(
    session.runtime.harness,
    session.runtime.root.id,
    BACKGROUND_CONTEXT,
  );
  session.streams.set(subscriptionId, stream);
  // The attachment snapshot is not delivered through start(); forward it first so the client has
  // committed state before any delta (§3.4).
  rpc.notify(HARNESS_METHODS.event, { subscriptionId, events: [stream.snapshot] });
  stream.start(async (batch) => {
    rpc.notify(HARNESS_METHODS.event, { subscriptionId, events: batch });
    for (const event of batch) {
      const type = eventType(event);
      if (type === "run_start") rpc.notify(HARNESS_METHODS.status, { status: "running" });
      if (type === "run_end") rpc.notify(HARNESS_METHODS.status, { status: "idle" });
    }
    await session.pump.drain();
  });
}

async function handleInit(params: unknown): Promise<{ conversationId: string }> {
  const init = asInitParams(params);
  const runtime = await openSessionRuntime({
    dbPath: init.dbPath,
    cwd: init.cwd,
    model: init.model,
    thinkingLevel: init.thinkingLevel,
    credentials: createProxyCredentialStore(rpc),
    compaction: init.compaction,
  });
  runtime.harness.resume();
  const pump = new EntryPump(runtime.root, (entry) => rpc.notify(HARNESS_METHODS.entry, { entry }));
  await pump.drain();
  session = { runtime, pump, streams: new Map() };
  await attach(session, "mirror");
  const conversationId = String(runtime.root.id);
  rpc.notify(HARNESS_METHODS.ready, { conversationId });
  return { conversationId };
}

async function handleSubmit(params: unknown): Promise<{ submissionId: string; status: string }> {
  const { requestId, text } = asSubmitParams(params);
  const submission = await requireSession().runtime.root.submit(
    { type: "input", content: text, requestId },
    BACKGROUND_CONTEXT,
  );
  return { submissionId: String(submission.id), status: "admitted" };
}

rpc.onRequest(SERVER_METHODS.init, handleInit);
// Pi Durable applies a change to the next request, not the one in flight, so a mid-turn change is
// safe: it lands on the following turn rather than disturbing the answer being written.
rpc.onRequest(SERVER_METHODS.configure, async (params) => {
  const { model, thinkingLevel } = asConfigureParams(params);
  await requireSession().runtime.root.configure({ model, thinkingLevel }, BACKGROUND_CONTEXT);
  return {};
});
rpc.onRequest(SERVER_METHODS.submit, handleSubmit);
rpc.onRequest(SERVER_METHODS.subscribe, async (params) => {
  const { subscriptionId } = asSubscribeParams(params);
  await attach(requireSession(), subscriptionId);
  return { subscriptionId };
});
rpc.onRequest(SERVER_METHODS.unsubscribe, async (params) => {
  const { subscriptionId } = asUnsubscribeParams(params);
  const open = requireSession();
  const stream = open.streams.get(subscriptionId);
  open.streams.delete(subscriptionId);
  await stream?.stop();
  return {};
});
rpc.onRequest(SERVER_METHODS.abort, async () => {
  await requireSession().runtime.root.abort(BACKGROUND_CONTEXT);
  return {};
});
rpc.onRequest(SERVER_METHODS.shutdown, async () => {
  await session?.runtime.close();
  return {};
});

rpc.onClose(() => {
  void session?.runtime.close().finally(() => process.exit(0));
});
rpc.start();
