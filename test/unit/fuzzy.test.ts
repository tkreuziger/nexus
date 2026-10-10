import { describe, expect, test } from "bun:test";
import { fuzzyMatch, fuzzyRank } from "../../apps/web/src/fuzzy.ts";

describe("fuzzyMatch", () => {
  test("matches a subsequence and reports where it matched", () => {
    const match = fuzzyMatch("svi", "src/sessions/view.ts");
    expect(match).not.toBeNull();
    expect(match?.indices.length).toBe(3);
    // The indices are ascending and point at the characters the query asked for.
    const target = "src/sessions/view.ts";
    const matched = (match?.indices ?? []).map((index) => target[index]).join("");
    expect(matched).toBe("svi");
  });

  test("returns null when a character is missing or out of order", () => {
    expect(fuzzyMatch("zzz", "src/view.ts")).toBeNull();
    expect(fuzzyMatch("xy", "src/view.ts")).toBeNull();
    // Every character is present, but not in this order.
    expect(fuzzyMatch("vwe", "src/view.ts")).toBeNull();
  });

  test("an empty query matches everything, so an empty prompt still lists files", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
  });

  test("is case-insensitive", () => {
    expect(fuzzyMatch("VIEW", "src/view.ts")).not.toBeNull();
  });

  test("prefers a contiguous run over scattered characters", () => {
    const contiguous = fuzzyMatch("view", "src/view.ts")?.score ?? 0;
    const scattered = fuzzyMatch("view", "v/i/e/w.ts")?.score ?? 0;
    expect(contiguous).toBeGreaterThan(scattered);
  });

  test("prefers the shorter of two equally matched targets", () => {
    const short = fuzzyMatch("ab", "ab.ts")?.score ?? 0;
    const long = fuzzyMatch("ab", "a/deeply/nested/b.ts")?.score ?? 0;
    expect(short).toBeGreaterThan(long);
  });
});

describe("fuzzyRank", () => {
  const files = ["src/sessions/view.ts", "src/view.ts", "README.md", "src/server/routes/fs.ts"];

  test("ranks the best match first and keeps at most the limit", () => {
    const ranked = fuzzyRank("view", files, (file) => file, 2);
    expect(ranked.length).toBe(2);
    expect(ranked[0]?.item).toBe("src/view.ts");
  });

  test("drops what does not match at all", () => {
    expect(fuzzyRank("zzz", files, (file) => file, 10)).toEqual([]);
  });

  test("an empty query keeps the source order rather than shuffling it", () => {
    expect(fuzzyRank("", files, (file) => file, 10).map((entry) => entry.item)).toEqual(files);
  });

  test("carries the match indices through, so a row can be highlighted", () => {
    const [first] = fuzzyRank("fs", files, (file) => file, 1);
    expect(first?.item).toBe("src/server/routes/fs.ts");
    expect(first?.indices.length).toBe(2);
  });
});
