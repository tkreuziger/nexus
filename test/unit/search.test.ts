import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchProject } from "../../src/projects/search.ts";

let root: string;
let outside: string;

const text = (result: Awaited<ReturnType<typeof searchProject>>) =>
  result.matches.map((match) => `${match.path}:${match.line}:${match.column}`);

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "nexus-search-"));
  root = join(base, "project");
  outside = join(base, "outside");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(root, "node_modules"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, "README.md"), "# Project\nnothing here\n");
  writeFileSync(join(root, "src", "index.ts"), "export const needle = 1;\nconst other = 2;\n");
  writeFileSync(join(root, ".git", "config"), "needle\n");
  writeFileSync(join(root, "node_modules", "dep.js"), "needle\n");
  writeFileSync(join(outside, "secret.txt"), "needle\n");
  writeFileSync(join(root, "binary.bin"), Buffer.from([0, 1, 2, 3, 0x4e]));
});

describe("searchProject", () => {
  test("finds a case-insensitive match with line, column, and text", async () => {
    const result = await searchProject(root, "NEEDLE", 100);
    expect(result.truncated).toBe(false);
    expect(result.matches).toEqual([
      { path: "src/index.ts", line: 1, column: 14, text: "export const needle = 1;" },
    ]);
  });

  test("reports every matching line", async () => {
    writeFileSync(join(root, "src", "index.ts"), "needle\nx\nneedle again\n");
    const result = await searchProject(root, "needle", 100);
    expect(text(result)).toEqual(["src/index.ts:1:1", "src/index.ts:3:1"]);
  });

  test("skips .git, node_modules, binaries, and symlinks", async () => {
    symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));
    const result = await searchProject(root, "needle", 100);
    expect(text(result)).toEqual(["src/index.ts:1:14"]);
  });

  test("caps the matches and reports truncation", async () => {
    writeFileSync(join(root, "many.txt"), "needle\n".repeat(10));
    const result = await searchProject(root, "needle", 3);
    expect(result.matches).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  test("returns nothing for a miss", async () => {
    const result = await searchProject(root, "absent", 100);
    expect(result).toEqual({ matches: [], truncated: false });
  });
});
