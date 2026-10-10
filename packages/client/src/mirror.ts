import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { MirrorContent } from "./wire.ts";

/**
 * Decode a mirror row's `content`, which the server stores as a JSON string. A value that cannot be
 * decoded is shown as-is rather than dropped, so a transcript never silently loses a row.
 */
export function parseMirrorContent(raw: string): MirrorContent {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as MirrorContent).text === "string"
    ) {
      return parsed as MirrorContent;
    }
  } catch {
    // Falls through to the raw text.
  }
  return { text: raw };
}

/**
 * Normalize an in-flight assistant message into the same shape as a committed row, so one component
 * renders both. This mirrors the server's normalization in `src/sessions/mirror.ts`; the two must
 * agree or a message would change appearance the moment it commits.
 */
export function mirrorContentOfAssistant(message: AssistantMessage): MirrorContent {
  const texts: string[] = [];
  const thinking: string[] = [];
  const toolCalls: NonNullable<MirrorContent["toolCalls"]> = [];
  for (const block of message.content) {
    if (block.type === "text") {
      if (block.text !== "") texts.push(block.text);
    } else if (block.type === "thinking") {
      if (block.thinking !== "") thinking.push(block.thinking);
    } else {
      toolCalls.push({ id: block.id, name: block.name, arguments: block.arguments });
    }
  }
  const content: MirrorContent = { text: texts.join("\n") };
  if (thinking.length > 0) content.thinking = thinking.join("\n");
  if (toolCalls.length > 0) content.toolCalls = toolCalls;
  return content;
}
