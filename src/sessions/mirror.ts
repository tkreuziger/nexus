import { asArray, asNonEmptyString, asRecord } from "../records.ts";
import type { MessageRole } from "../types.ts";

/** Normalized, renderable payload stored in `message_mirror.content`. */
export interface MirrorContent {
  text: string;
  thinking?: string;
  toolCalls?: { id: string; name: string; arguments: unknown }[];
  toolName?: string;
}

export interface MirrorMapping {
  entryId: string;
  role: MessageRole;
  content: string;
}

const ROLE_BY_KIND: Record<string, MessageRole | undefined> = {
  "pi.user": "user",
  "pi.assistant": "assistant",
  "pi.tool-result": "tool",
  "pi.reset": "meta",
  "pi.compaction": "meta",
};

const blocksOf = (message: Record<string, unknown>): Record<string, unknown>[] =>
  asArray(message.content)
    .map(asRecord)
    .filter((block): block is Record<string, unknown> => block !== undefined);

function contentOfBlocks(blocks: readonly Record<string, unknown>[]): MirrorContent {
  const texts: string[] = [];
  const thinking: string[] = [];
  const toolCalls: MirrorContent["toolCalls"] = [];
  for (const block of blocks) {
    const text = asNonEmptyString(block.text);
    if (block.type === "text" && text !== undefined) texts.push(text);
    if (block.type === "thinking" && text !== undefined) thinking.push(text);
    if (block.type === "toolCall") {
      toolCalls.push({
        id: asNonEmptyString(block.id) ?? "",
        name: asNonEmptyString(block.name) ?? "",
        arguments: block.arguments ?? null,
      });
    }
  }
  const content: MirrorContent = { text: texts.join("\n") };
  if (thinking.length > 0) content.thinking = thinking.join("\n");
  if (toolCalls.length > 0) content.toolCalls = toolCalls;
  return content;
}

/** A user message carries either a plain string or content blocks; an assistant message only blocks. */
function contentOfMessage(message: Record<string, unknown> | undefined): MirrorContent {
  if (message === undefined) return { text: "" };
  const raw = message.content;
  if (typeof raw === "string") return { text: raw };
  const content = contentOfBlocks(blocksOf(message));
  const toolName = asNonEmptyString(message.toolName);
  if (toolName !== undefined) content.toolName = toolName;
  return content;
}

/**
 * Map one committed `EntryRecord` to a mirror row. `pi.system` entries carry prompt bookkeeping the
 * transcript does not show, so they are skipped.
 */
export function toMirrorMapping(entry: unknown): MirrorMapping | undefined {
  const record = asRecord(entry);
  if (record === undefined) return undefined;
  const kind = asNonEmptyString(record.kind);
  const role = kind === undefined ? undefined : ROLE_BY_KIND[kind];
  if (role === undefined) return undefined;
  const content = contentOfMessage(asRecord(asArray(record.model)[0]));
  if (role === "meta" && content.text === "") {
    content.text = kind === "pi.compaction" ? "context compacted" : "context reset";
  }
  return { entryId: String(record.id), role, content: JSON.stringify(content) };
}
