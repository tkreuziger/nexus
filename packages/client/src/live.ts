import type { AssistantMessage, JsonObject, Message, Usage } from "@earendil-works/pi-ai";
import type {
  MessageChange,
  SnapshotEvent,
  ToolSlot,
  UsageState,
} from "@earendil-works/pi-durable";
import type { SessionStatus, StreamFrame } from "./wire.ts";

/**
 * A pure reduction of the session event stream into renderable state.
 *
 * It deliberately carries no committed transcript: the mirror is the authority for that (compaction
 * rewrites Pi Durable's own history but never the mirror), so this state is only the *live overlay* —
 * the in-flight assistant message, the current tool round, usage, and the notices a user needs while
 * waiting. `transcriptVersion` is the join: when it changes, the caller refetches the mirror.
 *
 * Shared by every client, since a CLI needs the same reduction to render a stream.
 */

export interface LiveToolCall {
  callId: string;
  name: string;
  status: ToolSlot["status"];
  /** Absent until `tool_execution_start`, and for tools a snapshot reports without their call. */
  args: JsonObject | null;
  output: string;
}

export interface LiveCompaction {
  taskId: string;
  reason: string;
  blocking: boolean;
}

export interface LiveNotice {
  kind: "retry" | "deferred";
  text: string;
}

export interface LiveState {
  status: SessionStatus | null;
  /** The in-flight assistant message, rebuilt from deltas. Null between turns. */
  message: AssistantMessage | null;
  tools: readonly LiveToolCall[];
  /** Cumulative usage across the conversation, from `snapshot` and `usage_changed`. */
  usage: UsageState | null;
  /** The partial's own usage, from `message_update`. */
  partialUsage: Usage | null;
  inbox: readonly { id: number; mode: string }[];
  compactions: readonly LiveCompaction[];
  notice: LiveNotice | null;
  failures: readonly { kind: string; message: string }[];
  /** Bumped whenever committed state advanced. Refetch the transcript when it changes. */
  transcriptVersion: number;
}

export const initialLiveState: LiveState = {
  status: null,
  message: null,
  tools: [],
  usage: null,
  partialUsage: null,
  inbox: [],
  compactions: [],
  notice: null,
  failures: [],
  transcriptVersion: 0,
};

const asAssistant = (message: Message): AssistantMessage | null =>
  message.role === "assistant" ? message : null;

const setBlock = (
  content: AssistantMessage["content"],
  index: number,
  block: AssistantMessage["content"][number],
): AssistantMessage["content"] => {
  const next = [...content];
  next[index] = block;
  return next;
};

const appendText = (
  content: AssistantMessage["content"],
  index: number,
  delta: string,
): AssistantMessage["content"] => {
  const block = content[index];
  if (block === undefined) return content;
  if (block.type === "text")
    return setBlock(content, index, { ...block, text: block.text + delta });
  if (block.type === "thinking") {
    return setBlock(content, index, { ...block, thinking: block.thinking + delta });
  }
  return content;
};

/** Append `delta` at `path` inside `target`, cloning as it goes. Used for streamed tool-call input. */
const appendInto = (
  target: unknown,
  path: readonly (string | number)[],
  delta: string,
): unknown => {
  const [head, ...rest] = path;
  if (head === undefined) return typeof target === "string" ? target + delta : delta;
  if (typeof head === "number") {
    const list = Array.isArray(target) ? [...target] : [];
    list[head] = appendInto(list[head], rest, delta);
    return list;
  }
  const source = typeof target === "object" && target !== null ? (target as JsonObject) : {};
  return { ...source, [head]: appendInto(source[head], rest, delta) };
};

const appendToolCallDelta = (
  content: AssistantMessage["content"],
  index: number,
  path: readonly (string | number)[],
  delta: string,
): AssistantMessage["content"] => {
  const block = content[index];
  if (block === undefined) return content;
  return setBlock(
    content,
    index,
    appendInto(block, path, delta) as AssistantMessage["content"][number],
  );
};

/** Rebuild an assistant message from one batch of `message_update` changes. */
export function applyMessageChanges(
  message: AssistantMessage,
  changes: readonly MessageChange[],
): AssistantMessage {
  let content = message.content;
  for (const change of changes) {
    switch (change.type) {
      case "message":
        return change.message;
      case "text_delta":
      case "thinking_delta":
        content = appendText(content, change.contentIndex, change.delta);
        break;
      case "toolcall_delta":
        content = appendToolCallDelta(content, change.contentIndex, change.path, change.delta);
        break;
      default:
        content = setBlock(content, change.contentIndex, change.block);
        break;
    }
  }
  return { ...message, content };
}

/** A tool output update is either a replacement or a front trim plus an append. */
const applyOutput = (
  current: string,
  update: { trimStart?: number; append?: string } | { set: string } | undefined,
): string => {
  if (update === undefined) return current;
  if ("set" in update) return update.set;
  const base = update.trimStart === undefined ? current : current.slice(update.trimStart);
  return base + (update.append ?? "");
};

const upsertTool = (
  tools: readonly LiveToolCall[],
  patch: { callId: string } & Partial<Omit<LiveToolCall, "callId">>,
): LiveToolCall[] => {
  const index = tools.findIndex((tool) => tool.callId === patch.callId);
  const current = tools[index];
  if (current === undefined) {
    return [
      ...tools,
      {
        callId: patch.callId,
        name: patch.name ?? "",
        status: patch.status ?? "pending",
        args: patch.args ?? null,
        output: patch.output ?? "",
      },
    ];
  }
  const next = [...tools];
  next[index] = { ...current, ...patch };
  return next;
};

const fromSnapshot = (state: LiveState, frame: SnapshotEvent): LiveState => ({
  ...state,
  message: frame.generation?.message ?? null,
  tools: (frame.tools ?? []).map((tool) => ({
    callId: tool.callId,
    name: tool.name,
    status: tool.status,
    args: null,
    output: tool.output ?? "",
  })),
  usage: frame.usage,
  inbox: frame.inbox.map((item) => ({ id: item.id, mode: item.mode })),
  compactions: (frame.compactions ?? []).map((item) => ({
    taskId: String(item.taskId),
    reason: String(item.reason),
    blocking: item.blocking,
  })),
  notice:
    frame.generation?.retry === undefined
      ? frame.generation?.deferred === undefined
        ? null
        : {
            kind: "deferred",
            text: `waiting until ${new Date(frame.generation.deferred.pollAt).toLocaleTimeString()}`,
          }
      : {
          kind: "retry",
          text: `attempt ${frame.generation.attempt}: ${frame.generation.retry.error}`,
        },
});

/**
 * Fold one frame into the live state. Frames that carry no presentation state of their own — turn
 * boundaries, submissions, agent changes — return the state unchanged, and so does any event a newer
 * Pi Durable adds.
 */
export function reduceLiveState(state: LiveState, frame: StreamFrame): LiveState {
  switch (frame.type) {
    case "session_status":
      return { ...state, status: frame.status };
    case "snapshot":
      return fromSnapshot(state, frame);
    case "run_start":
      return { ...state, notice: null };
    case "run_end":
      return {
        ...state,
        message: null,
        tools: [],
        notice: null,
        transcriptVersion: state.transcriptVersion + 1,
      };
    case "message_start":
      return { ...state, message: asAssistant(frame.message), tools: [] };
    case "message_update":
      return {
        ...state,
        message: state.message === null ? null : applyMessageChanges(state.message, frame.changes),
        partialUsage: frame.usage,
      };
    case "message_end":
      return { ...state, message: null, transcriptVersion: state.transcriptVersion + 1 };
    case "tool_execution_start":
      return {
        ...state,
        tools: upsertTool(state.tools, {
          callId: frame.toolCallId,
          name: frame.toolName,
          args: frame.args,
          status: "running",
        }),
      };
    case "tool_execution_update":
      return {
        ...state,
        tools: upsertTool(state.tools, {
          callId: frame.toolCallId,
          name: frame.toolName,
          output: applyOutput(
            state.tools.find((tool) => tool.callId === frame.toolCallId)?.output ?? "",
            frame.output,
          ),
        }),
      };
    case "tool_execution_end":
      return {
        ...state,
        tools: upsertTool(state.tools, { callId: frame.toolCallId, status: "done" }),
      };
    case "entry_appended":
      return { ...state, transcriptVersion: state.transcriptVersion + 1 };
    case "usage_changed":
      return { ...state, usage: frame.usage };
    case "inbox_update":
      return { ...state, inbox: frame.items.map((item) => ({ id: item.id, mode: item.mode })) };
    case "compaction_start":
      return {
        ...state,
        compactions: [
          ...state.compactions.filter((item) => item.taskId !== String(frame.taskId)),
          { taskId: String(frame.taskId), reason: String(frame.reason), blocking: frame.blocking },
        ],
      };
    case "compaction_end":
      return {
        ...state,
        compactions: state.compactions.filter((item) => item.taskId !== String(frame.taskId)),
        transcriptVersion: state.transcriptVersion + 1,
      };
    case "auto_retry_start":
      return {
        ...state,
        notice: { kind: "retry", text: `attempt ${frame.attempt}: ${frame.errorMessage}` },
      };
    case "auto_retry_end":
      return { ...state, notice: null };
    case "deferred_poll":
      return {
        ...state,
        notice: {
          kind: "deferred",
          text: `waiting until ${new Date(frame.pollAt).toLocaleTimeString()}`,
        },
      };
    case "task_failed":
      return {
        ...state,
        failures: [...state.failures, { kind: String(frame.kind), message: frame.message }],
      };
    default:
      return state;
  }
}

/** Fold a batch of frames, which is how the stream delivers them. */
export function reduceFrames(state: LiveState, frames: readonly StreamFrame[]): LiveState {
  return frames.reduce(reduceLiveState, state);
}
