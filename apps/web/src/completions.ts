/**
 * What the prompt is currently offering to complete.
 *
 * Two triggers, one mechanism: `/` at the very start of the prompt opens the command palette, and
 * `@` anywhere opens the worktree file list. Both are worked out from the text and the caret alone,
 * so this is pure and testable without a textarea.
 */

export interface Trigger {
  kind: "command" | "mention";
  /** What has been typed after the trigger character. */
  query: string;
  /** Index of the trigger character; the completion replaces `[start, end)`. */
  start: number;
  /** The caret, which is where the completion ends. */
  end: number;
}

/** Walk back from the caret to the start of the token it sits in. */
function tokenStart(text: string, caret: number): number {
  let index = caret;
  while (index > 0 && !/\s/.test(text[index - 1] ?? "")) index -= 1;
  return index;
}

/**
 * The trigger under the caret, if there is one.
 *
 * A command is offered only at the very start of the prompt: a `/` further in is a path or a date,
 * and hijacking it would make ordinary prose unusable. A mention is offered anywhere, because an
 * `@` in prose is rare and the point of the feature is to reference a file mid-sentence.
 */
export function detectTrigger(text: string, caret: number): Trigger | null {
  const start = tokenStart(text, caret);
  const token = text.slice(start, caret);
  // The span runs to the end of the token, not to the caret: completing in the middle of a path
  // should replace the whole thing rather than leave its tail stranded behind the completion.
  let end = caret;
  while (end < text.length && !/\s/.test(text[end] ?? "")) end += 1;
  if (start === 0 && token.startsWith("/")) {
    return { kind: "command", query: token.slice(1), start: 0, end };
  }
  const at = token.lastIndexOf("@");
  if (at !== -1) {
    return { kind: "mention", query: token.slice(at + 1), start: start + at, end };
  }
  return null;
}

/** Replace the trigger's span with `replacement`, and report where the caret should land. */
export function applyCompletion(
  text: string,
  trigger: Trigger,
  replacement: string,
): { text: string; caret: number } {
  return {
    text: text.slice(0, trigger.start) + replacement + text.slice(trigger.end),
    caret: trigger.start + replacement.length,
  };
}
