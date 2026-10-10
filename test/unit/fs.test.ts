import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { listDirectories } from "../../src/fs.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join("/tmp", "nexus-fs-"));
  mkdirSync(join(root, "alpha", ".git"), { recursive: true });
  mkdirSync(join(root, "beta"), { recursive: true });
  writeFileSync(join(root, "loose.txt"), "not a directory\n");
});

describe("listDirectories", () => {
  test("lists only directories, sorted, marking git repositories", async () => {
    const result = await listDirectories(root, 100);
    expect(result.path).toBe(await realpath(root));
    expect(result.entries).toEqual([
      { name: "alpha", path: join(result.path, "alpha"), git: true },
      { name: "beta", path: join(result.path, "beta"), git: false },
    ]);
  });

  test("caps the number of entries", async () => {
    const result = await listDirectories(root, 1);
    expect(result.entries.map((entry) => entry.name)).toEqual(["alpha"]);
  });

  test("expands a leading tilde to the home directory", async () => {
    const result = await listDirectories("~", 5);
    expect(result.path).toBe(await realpath(homedir()));
  });

  test("defaults an empty path to the home directory", async () => {
    const result = await listDirectories("", 5);
    expect(result.path).toBe(await realpath(homedir()));
  });

  test("rejects a file and a missing path with 422", async () => {
    await expect(listDirectories(join(root, "loose.txt"), 10)).rejects.toMatchObject({
      status: 422,
    });
    await expect(listDirectories(join(root, "nope"), 10)).rejects.toMatchObject({ status: 422 });
  });
});
