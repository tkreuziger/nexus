import { describe, expect, test } from "bun:test";
import { applyCompletion, detectTrigger } from "../../apps/web/src/completions.ts";

describe("detectTrigger", () => {
  test("a leading slash opens the command palette", () => {
    expect(detectTrigger("/abo", 4)).toEqual({ kind: "command", query: "abo", start: 0, end: 4 });
  });

  test("a slash further in is a path, not a command", () => {
    expect(detectTrigger("see src/foo", 12)).toBeNull();
  });

  test("an at sign opens the file list anywhere in the prompt", () => {
    expect(detectTrigger("look at @sr", 11)).toEqual({
      kind: "mention",
      query: "sr",
      start: 8,
      end: 11,
    });
  });

  test("the query is the token under the caret, not the whole line", () => {
    expect(detectTrigger("look at @src/vie", 16)?.query).toBe("src/vie");
  });

  test("ordinary prose triggers nothing", () => {
    expect(detectTrigger("hello world", 11)).toBeNull();
    expect(detectTrigger("mail me at foo", 15)).toBeNull();
  });

  test("the span reaches the end of the token, so completing mid-path replaces the tail", () => {
    // The caret sits between "view" and ".ts"; the query is what is behind it, but the span runs on
    // to the end of the path so the completion does not strand ".ts" behind it.
    expect(detectTrigger("@src/view.ts and more", 9)).toEqual({
      kind: "mention",
      query: "src/view",
      start: 0,
      end: 12,
    });
  });
});

describe("applyCompletion", () => {
  const triggerOf = (text: string, caret: number) => {
    const trigger = detectTrigger(text, caret);
    if (trigger === null) throw new Error(`expected a trigger in ${JSON.stringify(text)}`);
    return trigger;
  };

  test("a mention replaces the whole token and leaves the surrounding prose alone", () => {
    // `applyCompletion` is a plain splice; whether the path takes a trailing space is the caller's
    // policy, so the replacement here carries none.
    const text = "see @src/vi more";
    const next = applyCompletion(text, triggerOf(text, 11), "@src/view.ts");
    expect(next.text).toBe("see @src/view.ts more");
    expect(next.caret).toBe("see @src/view.ts".length);
  });

  test("a command takes its own token away", () => {
    expect(applyCompletion("/abort", triggerOf("/abort", 6), "")).toEqual({ text: "", caret: 0 });
  });

  test("a command leaves whatever followed it", () => {
    expect(applyCompletion("/abort now", triggerOf("/abort now", 6), "").text).toBe(" now");
  });
});
