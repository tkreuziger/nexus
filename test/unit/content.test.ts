import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectContent } from "../../src/projects/content.ts";

let root: string;
let outside: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "nexus-content-"));
  root = join(base, "project");
  outside = join(base, "outside");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, "README.md"), "# project\n");
  writeFileSync(join(root, "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(outside, "secret.txt"), "do not read me\n");
});

describe("readProjectContent", () => {
  test("lists the root directory", async () => {
    const result = await readProjectContent(root, "");
    expect(result.kind).toBe("directory");
    if (result.kind !== "directory") return;
    expect(result.entries.map((entry) => entry.name).sort()).toEqual(["README.md", "src"]);
  });

  test("lists a nested directory", async () => {
    const result = await readProjectContent(root, "src");
    expect(result.kind).toBe("directory");
    if (result.kind !== "directory") return;
    expect(result.entries.map((entry) => entry.name)).toEqual(["index.ts"]);
  });

  test("reads a file", async () => {
    const result = await readProjectContent(root, "README.md");
    expect(result.kind).toBe("file");
    if (result.kind !== "file") return;
    expect(result.text).toBe("# project\n");
  });

  test("rejects parent traversal", async () => {
    await expect(readProjectContent(root, "../outside/secret.txt")).rejects.toThrow();
  });

  test("rejects deep traversal", async () => {
    await expect(readProjectContent(root, "src/../../outside/secret.txt")).rejects.toThrow();
  });

  test("rejects an absolute path outside the root", async () => {
    await expect(readProjectContent(root, join(outside, "secret.txt"))).rejects.toThrow();
  });

  test("rejects a symlink escaping the root", async () => {
    symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));
    await expect(readProjectContent(root, "escape.txt")).rejects.toThrow();
  });

  test("rejects a missing path", async () => {
    await expect(readProjectContent(root, "nope.txt")).rejects.toThrow();
  });

  test("reports the escape as a 400 and the miss as a 404", async () => {
    await expect(readProjectContent(root, "../outside")).rejects.toMatchObject({ status: 400 });
    await expect(readProjectContent(root, "nope.txt")).rejects.toMatchObject({ status: 404 });
  });
});
