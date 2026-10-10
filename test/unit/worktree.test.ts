import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGit } from "../../src/projects/git.ts";
import { createWorktree, removeWorktree, worktreePathFor } from "../../src/sessions/worktree.ts";

let base: string;
let projectPath: string;
let worktreesRoot: string;

const makeRepo = async (): Promise<string> => {
  const path = join(base, "demo");
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "README.md"), "# demo\n");
  await runGit(["init", "-b", "main"], path);
  await runGit(["add", "."], path);
  await runGit(
    ["-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-m", "init"],
    path,
  );
  return path;
};

const spec = (sessionName: string, sessionId = "session-1") => ({
  projectPath,
  projectName: "demo",
  sessionId,
  sessionName,
  baseRef: "HEAD",
  root: worktreesRoot,
});

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "nexus-worktree-"));
  worktreesRoot = join(base, "projects-root");
  mkdirSync(worktreesRoot, { recursive: true });
  projectPath = await makeRepo();
});

describe("worktreePathFor", () => {
  test("nests the worktree under the projects root, outside the checkout", () => {
    expect(worktreePathFor(worktreesRoot, "demo", "session-1")).toBe(
      join(worktreesRoot, ".pi-worktrees", "demo", "session-1"),
    );
  });
});

describe("createWorktree", () => {
  test("creates a worktree on the session branch", async () => {
    const created = await createWorktree(spec("alpha"));
    expect(created.branch).toBe("pi/alpha");
    expect(created.path).toBe(worktreePathFor(worktreesRoot, "demo", "session-1"));
    expect(existsSync(join(created.path, "README.md"))).toBe(true);
    const branches = await runGit(["branch", "--list", "pi/alpha"], projectPath);
    expect(branches).toContain("pi/alpha");
  });

  test("keeps the worktree out of the main checkout", async () => {
    const created = await createWorktree(spec("alpha"));
    const status = await runGit(["status", "--porcelain"], projectPath);
    expect(status.trim()).toBe("");
    expect(created.path.startsWith(projectPath)).toBe(false);
  });

  test("isolates edits from the main checkout and other sessions", async () => {
    const first = await createWorktree(spec("alpha", "s1"));
    const second = await createWorktree(spec("beta", "s2"));
    writeFileSync(join(first.path, "only-in-alpha.txt"), "x");
    expect(existsSync(join(second.path, "only-in-alpha.txt"))).toBe(false);
    expect(existsSync(join(projectPath, "only-in-alpha.txt"))).toBe(false);
    const mainStatus = await runGit(["status", "--porcelain"], projectPath);
    expect(mainStatus.trim()).toBe("");
  });

  test("rejects a session name that is not a valid branch", async () => {
    await expect(createWorktree(spec("bad name"))).rejects.toMatchObject({ status: 400 });
    await expect(createWorktree(spec("bad..name"))).rejects.toMatchObject({ status: 400 });
  });

  test("reports a taken branch as 409", async () => {
    await createWorktree(spec("alpha", "s1"));
    await expect(createWorktree(spec("alpha", "s2"))).rejects.toMatchObject({ status: 409 });
  });
});

describe("removeWorktree", () => {
  test("removes a clean worktree and preserves the branch", async () => {
    const created = await createWorktree(spec("alpha"));
    await removeWorktree(projectPath, created.path);
    expect(existsSync(created.path)).toBe(false);
    const branches = await runGit(["branch", "--list", "pi/alpha"], projectPath);
    expect(branches).toContain("pi/alpha");
    const listed = await runGit(["worktree", "list", "--porcelain"], projectPath);
    expect(listed).not.toContain(created.path);
  });

  test("refuses a worktree with uncommitted work", async () => {
    const created = await createWorktree(spec("alpha"));
    writeFileSync(join(created.path, "dirty.txt"), "uncommitted");
    await expect(removeWorktree(projectPath, created.path)).rejects.toMatchObject({ status: 409 });
    expect(existsSync(created.path)).toBe(true);
  });

  test("removes a dirty worktree when forced", async () => {
    const created = await createWorktree(spec("alpha"));
    writeFileSync(join(created.path, "dirty.txt"), "uncommitted");
    await removeWorktree(projectPath, created.path, { force: true });
    expect(existsSync(created.path)).toBe(false);
  });

  test("prunes the session directory left behind", async () => {
    const created = await createWorktree(spec("alpha"));
    await removeWorktree(projectPath, created.path);
    const parent = join(worktreesRoot, ".pi-worktrees", "demo");
    expect(readdirSync(parent)).toEqual([]);
  });
});
