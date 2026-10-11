/**
 * A line diff for a file edit, computed here rather than taken from the tool.
 *
 * The edit tool does return its own diff in its details, but details do not reach the mirror — what
 * does reach us is the call's arguments, which carry the `oldText`/`newText` pair that was applied.
 * That is enough to render the change, and it means no diff dependency and no change to the wire.
 */

export interface DiffLine {
  kind: "same" | "removed" | "added";
  text: string;
}

export interface FileEdit {
  path: string;
  edits: { oldText: string; newText: string }[];
}

/**
 * The change between two blocks, as a single hunk: the common head, the replaced middle, the common
 * tail. An edit replaces one contiguous run with another, so trimming the shared ends is exactly the
 * right shape and avoids carrying an LCS for a case that cannot arise.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;

  const shared = Math.min(a.length - head, b.length - head);
  let tail = 0;
  while (tail < shared && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;

  const lines: DiffLine[] = [];
  const push = (kind: DiffLine["kind"], text: string | undefined): void => {
    lines.push({ kind, text: text ?? "" });
  };
  for (let i = 0; i < head; i += 1) push("same", a[i]);
  for (let i = head; i < a.length - tail; i += 1) push("removed", a[i]);
  for (let i = head; i < b.length - tail; i += 1) push("added", b[i]);
  for (let i = a.length - tail; i < a.length; i += 1) push("same", a[i]);
  return lines;
}

/**
 * Read a tool call's arguments as a file edit, or return null when they are something else.
 *
 * Matched by shape rather than by tool name: any call carrying a path and a list of old/new pairs is
 * showing a file change, whatever it is called.
 */
export function asFileEdit(args: unknown): FileEdit | null {
  if (typeof args !== "object" || args === null) return null;
  const record = args as Record<string, unknown>;
  if (typeof record.path !== "string" || !Array.isArray(record.edits)) return null;
  const edits: FileEdit["edits"] = [];
  for (const entry of record.edits) {
    if (typeof entry !== "object" || entry === null) continue;
    const { oldText, newText } = entry as Record<string, unknown>;
    if (typeof oldText === "string" && typeof newText === "string")
      edits.push({ oldText, newText });
  }
  return edits.length === 0 ? null : { path: record.path, edits };
}
