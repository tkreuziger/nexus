import { describe, expect, test } from "bun:test";
import { asFileEdit, diffLines } from "../../apps/web/src/diff.ts";

describe("diffLines", () => {
  test("keeps the common head and tail and marks the middle", () => {
    expect(diffLines("a\nb\nc", "a\nB\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "same", text: "c" },
    ]);
  });

  test("an insertion marks only the added lines", () => {
    expect(diffLines("a\nc", "a\nb\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: "b" },
      { kind: "same", text: "c" },
    ]);
  });

  test("a deletion marks only the removed lines", () => {
    expect(diffLines("a\nb\nc", "a\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "same", text: "c" },
    ]);
  });

  test("identical text is all context", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  test("a whole-block replacement has no context at all", () => {
    expect(diffLines("a", "b")).toEqual([
      { kind: "removed", text: "a" },
      { kind: "added", text: "b" },
    ]);
  });

  test("an empty side is one empty line, which is what splitting it yields", () => {
    expect(diffLines("", "a")).toEqual([
      { kind: "removed", text: "" },
      { kind: "added", text: "a" },
    ]);
  });
});

describe("asFileEdit", () => {
  test("reads a path and its old/new pairs", () => {
    const args = { path: "src/a.ts", edits: [{ oldText: "x", newText: "y" }] };
    expect(asFileEdit(args)).toEqual(args);
  });

  test("returns null when the arguments are not an edit", () => {
    expect(asFileEdit(null)).toBeNull();
    expect(asFileEdit("ls")).toBeNull();
    expect(asFileEdit({ command: "ls" })).toBeNull();
    expect(asFileEdit({ path: "a" })).toBeNull();
    expect(asFileEdit({ path: "a", edits: [] })).toBeNull();
    expect(asFileEdit({ path: "a", edits: [{ oldText: 1, newText: 2 }] })).toBeNull();
  });

  test("skips a malformed entry rather than dropping the whole call", () => {
    const edit = asFileEdit({ path: "a", edits: [{ oldText: "x", newText: "y" }, { oldText: 1 }] });
    expect(edit?.edits).toEqual([{ oldText: "x", newText: "y" }]);
  });
});
