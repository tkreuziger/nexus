import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { StreamFrame } from "@nexus/client";
import {
  applyMessageChanges,
  initialLiveState,
  type LiveState,
  reduceFrames,
  reduceLiveState,
} from "@nexus/client";

/**
 * The Pi Durable types carry branded ids and enum brands that a hand-built fixture cannot name, so
 * these helpers cast. The shapes below mirror what the harness actually sends.
 */
const asFrame = <T>(value: unknown): T => value as T;

const assistant = (content: AssistantMessage["content"]): AssistantMessage =>
  asFrame({
    role: "assistant",
    content,
    model: "faux-1",
    usage: asFrame<Usage>({}),
    stopReason: "stop",
  });

const usage = (): Usage =>
  asFrame<Usage>({
    input: 10,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 12,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  });

const snapshot = (overrides: Record<string, unknown> = {}): StreamFrame =>
  asFrame({
    type: "snapshot",
    entries: [],
    tools: [],
    compactions: [],
    inbox: [],
    agent: {},
    usage: { models: {}, tools: {} },
    ...overrides,
  });

const fold = (frames: readonly StreamFrame[]): LiveState => reduceFrames(initialLiveState, frames);

describe("session status and snapshots", () => {
  test("records the status", () => {
    expect(fold([asFrame({ type: "session_status", status: "running" })]).status).toBe("running");
  });

  test("adopts a snapshot's generation, tools, usage, inbox and compactions", () => {
    const state = fold([
      snapshot({
        generation: { attempt: 2, message: assistant([{ type: "text", text: "half" }]) },
        tools: [{ callId: "c1", name: "bash", status: "running", output: "so far" }],
        usage: { models: { "faux/faux-1": usage() }, tools: {} },
        inbox: [{ id: 7, mode: "followUp" }],
        compactions: [{ taskId: 3, reason: "threshold", blocking: true }],
      }),
    ]);

    expect(state.message?.content[0]).toEqual({ type: "text", text: "half" });
    expect(state.tools).toEqual([
      { callId: "c1", name: "bash", status: "running", args: null, output: "so far" },
    ]);
    expect(state.usage?.models["faux/faux-1"]).toEqual(usage());
    expect(state.inbox).toEqual([{ id: 7, mode: "followUp" }]);
    expect(state.compactions).toEqual([{ taskId: "3", reason: "threshold", blocking: true }]);
  });

  test("a snapshot replaces earlier live state rather than merging into it", () => {
    const state = fold([
      asFrame({ type: "tool_execution_start", toolCallId: "gone", toolName: "bash", args: {} }),
      snapshot(),
    ]);
    expect(state.tools).toEqual([]);
  });
});

describe("streaming an assistant message", () => {
  test("accumulates text across deltas", () => {
    const state = fold([
      asFrame({ type: "message_start", message: assistant([{ type: "text", text: "" }]) }),
      asFrame({
        type: "message_update",
        usage: usage(),
        changes: [{ type: "text_delta", contentIndex: 0, delta: "Hel" }],
      }),
      asFrame({
        type: "message_update",
        usage: usage(),
        changes: [{ type: "text_delta", contentIndex: 0, delta: "lo" }],
      }),
    ]);
    expect(state.message?.content).toEqual([{ type: "text", text: "Hello" }]);
    expect(state.partialUsage).toEqual(usage());
  });

  test("routes a thinking delta to thinking, not text", () => {
    const state = fold([
      asFrame({
        type: "message_start",
        message: assistant([{ type: "thinking", thinking: "" }]),
      }),
      asFrame({
        type: "message_update",
        usage: usage(),
        changes: [{ type: "thinking_delta", contentIndex: 0, delta: "why" }],
      }),
    ]);
    expect(state.message?.content).toEqual([{ type: "thinking", thinking: "why" }]);
  });

  test("builds partial tool-call arguments from a path delta", () => {
    const state = fold([
      asFrame({
        type: "message_start",
        message: assistant([{ type: "toolCall", id: "c1", name: "bash", arguments: {} }]),
      }),
      asFrame({
        type: "message_update",
        usage: usage(),
        changes: [
          {
            type: "toolcall_delta",
            contentIndex: 0,
            path: ["arguments", "command"],
            delta: "echo ",
          },
        ],
      }),
      asFrame({
        type: "message_update",
        usage: usage(),
        changes: [
          { type: "toolcall_delta", contentIndex: 0, path: ["arguments", "command"], delta: "hi" },
        ],
      }),
    ]);
    expect(state.message?.content[0]).toMatchObject({ arguments: { command: "echo hi" } });
  });

  test("a whole-message change replaces the partial", () => {
    const state = fold([
      asFrame({ type: "message_start", message: assistant([{ type: "text", text: "partial" }]) }),
      asFrame({
        type: "message_update",
        usage: usage(),
        changes: [{ type: "message", message: assistant([{ type: "text", text: "final" }]) }],
      }),
    ]);
    expect(state.message?.content).toEqual([{ type: "text", text: "final" }]);
  });

  test("leaves the message alone when no start was seen", () => {
    const state = fold([
      asFrame({
        type: "message_update",
        usage: usage(),
        changes: [{ type: "text_delta", contentIndex: 0, delta: "orphan" }],
      }),
    ]);
    expect(state.message).toBeNull();
  });

  test("applyMessageChanges does not mutate the message it is given", () => {
    const message = assistant([{ type: "text", text: "a" }]);
    applyMessageChanges(message, [{ type: "text_delta", contentIndex: 0, delta: "b" }]);
    expect(message.content).toEqual([{ type: "text", text: "a" }]);
  });
});

describe("tool calls", () => {
  test("follows start, streaming output, and end", () => {
    const state = fold([
      asFrame({
        type: "tool_execution_start",
        toolCallId: "c1",
        toolName: "bash",
        args: { command: "ls" },
      }),
      asFrame({
        type: "tool_execution_update",
        toolCallId: "c1",
        toolName: "bash",
        output: { set: "line 1\n" },
      }),
      asFrame({
        type: "tool_execution_update",
        toolCallId: "c1",
        toolName: "bash",
        output: { append: "line 2\n" },
      }),
      asFrame({ type: "tool_execution_end", toolCallId: "c1", toolName: "bash" }),
    ]);

    expect(state.tools).toEqual([
      {
        callId: "c1",
        name: "bash",
        status: "done",
        args: { command: "ls" },
        output: "line 1\nline 2\n",
      },
    ]);
  });

  test("a trim keeps the retained window and appends", () => {
    const state = fold([
      asFrame({
        type: "tool_execution_start",
        toolCallId: "c1",
        toolName: "bash",
        args: {},
      }),
      asFrame({
        type: "tool_execution_update",
        toolCallId: "c1",
        toolName: "bash",
        output: { set: "aaaa\nbbbb\n" },
      }),
      asFrame({
        type: "tool_execution_update",
        toolCallId: "c1",
        toolName: "bash",
        output: { trimStart: 5, append: "cccc\n" },
      }),
    ]);
    expect(state.tools[0]?.output).toBe("bbbb\ncccc\n");
  });

  test("keeps concurrent tools apart", () => {
    const state = fold([
      asFrame({ type: "tool_execution_start", toolCallId: "a", toolName: "bash", args: {} }),
      asFrame({ type: "tool_execution_start", toolCallId: "b", toolName: "read", args: {} }),
      asFrame({
        type: "tool_execution_update",
        toolCallId: "b",
        toolName: "read",
        output: { set: "file body" },
      }),
    ]);
    expect(state.tools.map((tool) => [tool.callId, tool.output])).toEqual([
      ["a", ""],
      ["b", "file body"],
    ]);
  });
});

describe("committed state", () => {
  test("run_end clears the overlay and signals a transcript refetch", () => {
    const state = fold([
      asFrame({ type: "message_start", message: assistant([{ type: "text", text: "hi" }]) }),
      asFrame({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: {} }),
      asFrame({ type: "run_end", inputs: [] }),
    ]);
    expect(state.message).toBeNull();
    expect(state.tools).toEqual([]);
    expect(state.transcriptVersion).toBe(1);
  });

  test("an appended entry and a finished compaction both advance the transcript", () => {
    const state = fold([
      asFrame({ type: "entry_appended", entry: { id: 1 } }),
      asFrame({ type: "compaction_end", taskId: 3, reason: "threshold" }),
    ]);
    expect(state.transcriptVersion).toBe(2);
  });

  test("message_end clears the partial without ending the run", () => {
    const state = fold([
      asFrame({ type: "message_start", message: assistant([{ type: "text", text: "hi" }]) }),
      asFrame({ type: "message_end", entry: { id: 1 } }),
    ]);
    expect(state.message).toBeNull();
    expect(state.transcriptVersion).toBe(1);
  });
});

describe("notices", () => {
  test("a retry notice appears and then clears", () => {
    const started = fold([
      asFrame({ type: "auto_retry_start", attempt: 2, at: 1, errorMessage: "rate limited" }),
    ]);
    expect(started.notice).toEqual({ kind: "retry", text: "attempt 2: rate limited" });
    expect(
      reduceLiveState(started, asFrame({ type: "auto_retry_end", attempt: 2 })).notice,
    ).toBeNull();
  });

  test("a failed task is recorded", () => {
    const state = fold([
      asFrame({ type: "task_failed", taskId: 1, kind: "tool", message: "boom" }),
    ]);
    expect(state.failures).toEqual([{ kind: "tool", message: "boom" }]);
  });

  test("an unrecognised frame is a no-op", () => {
    const before = fold([asFrame({ type: "session_status", status: "idle" })]);
    const after = reduceLiveState(before, asFrame({ type: "something_new", payload: 1 }));
    expect(after).toBe(before);
  });

  test("compaction start and end track one task by id", () => {
    const started = fold([
      asFrame({ type: "compaction_start", taskId: 5, reason: "threshold", blocking: false }),
    ]);
    expect(started.compactions).toHaveLength(1);
    const ended = reduceLiveState(
      started,
      asFrame({ type: "compaction_end", taskId: 5, reason: "threshold" }),
    );
    expect(ended.compactions).toEqual([]);
  });
});
