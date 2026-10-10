import { describe, expect, test } from "bun:test";
import { type MirrorContent, toMirrorMapping } from "../../src/sessions/mirror.ts";

const parse = (entry: unknown): { role: string; content: MirrorContent } | undefined => {
  const mapping = toMirrorMapping(entry);
  if (mapping === undefined) return undefined;
  return { role: mapping.role, content: JSON.parse(mapping.content) as MirrorContent };
};

describe("toMirrorMapping", () => {
  test("keeps the text of a user message stored as a plain string", () => {
    const mapped = parse({
      id: 3,
      kind: "pi.user",
      model: [{ role: "user", content: "hello there", timestamp: 0 }],
    });
    expect(mapped?.role).toBe("user");
    expect(mapped?.content.text).toBe("hello there");
  });

  test("keeps the text of a user message stored as content blocks", () => {
    const mapped = parse({
      id: 4,
      kind: "pi.user",
      model: [{ role: "user", content: [{ type: "text", text: "block form" }] }],
    });
    expect(mapped?.content.text).toBe("block form");
  });

  test("extracts assistant text and tool calls", () => {
    const mapped = parse({
      id: 5,
      kind: "pi.assistant",
      model: [
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "weighing options" },
            { type: "text", text: "reading the file" },
            { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.txt" } },
          ],
        },
      ],
    });
    expect(mapped?.role).toBe("assistant");
    expect(mapped?.content.text).toBe("reading the file");
    expect(mapped?.content.thinking).toBe("weighing options");
    expect(mapped?.content.toolCalls).toEqual([
      { id: "call-1", name: "read", arguments: { path: "a.txt" } },
    ]);
  });

  test("keeps a tool result with its tool name", () => {
    const mapped = parse({
      id: 6,
      kind: "pi.tool-result",
      model: [
        { role: "toolResult", toolName: "read", content: [{ type: "text", text: "contents" }] },
      ],
    });
    expect(mapped?.role).toBe("tool");
    expect(mapped?.content.text).toBe("contents");
    expect(mapped?.content.toolName).toBe("read");
  });

  test("labels a compaction entry", () => {
    const mapped = parse({ id: 7, kind: "pi.compaction", model: [] });
    expect(mapped?.role).toBe("meta");
    expect(mapped?.content.text).toBe("context compacted");
  });

  test("skips system entries", () => {
    expect(parse({ id: 8, kind: "pi.system", model: [] })).toBeUndefined();
  });

  test("ignores a malformed entry", () => {
    expect(toMirrorMapping("not an entry")).toBeUndefined();
    expect(toMirrorMapping({ id: 9, kind: "pi.user" })?.entryId).toBe("9");
  });
});
