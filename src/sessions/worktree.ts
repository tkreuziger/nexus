import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HttpError } from "../errors.ts";
import { runGit } from "../projects/git.ts";

/** Everything needed to place one session's worktree (ADR-7, `INPUT.md` §5.3). */
export interface WorktreeSpec {
  projectPath: string;
  projectName: string;
  sessionId: string;
  sessionName: string;
  baseRef: string;
  root: string;
}

const stderrOf = (error: unknown): string =>
  error !== null &&
  typeof error === "object" &&
  "stderr" in error &&
  typeof error.stderr === "string"
    ? error.stderr.trim()
    : error instanceof Error
      ? error.message
      : String(error);

/** Worktrees live outside the main checkout so `git status` and repo-walking tools stay clean. */
export function worktreePathFor(root: string, projectName: string, sessionId: string): string {
  return join(root, ".pi-worktrees", projectName, sessionId);
}

/** Reject a session name git cannot use as a branch, before anything is created. */
async function assertBranchUsable(projectPath: string, sessionName: string): Promise<string> {
  const branch = `pi/${sessionName}`;
  const valid = await runGit(["check-ref-format", "--branch", branch], projectPath).catch(
    () => undefined,
  );
  if (valid === undefined) {
    throw new HttpError(400, `"${sessionName}" is not usable as a git branch name`);
  }
  return branch;
}

/** Create the session's worktree on its own branch, based on `baseRef`. */
export async function createWorktree(
  spec: WorktreeSpec,
): Promise<{ path: string; branch: string }> {
  const branch = await assertBranchUsable(spec.projectPath, spec.sessionName);
  const path = worktreePathFor(spec.root, spec.projectName, spec.sessionId);
  await mkdir(dirname(path), { recursive: true });
  try {
    await runGit(["worktree", "add", "-b", branch, path, spec.baseRef], spec.projectPath);
  } catch (error) {
    const detail = stderrOf(error);
    if (detail.includes("already exists")) {
      throw new HttpError(409, `branch ${branch} already exists`);
    }
    throw new HttpError(500, `could not create worktree: ${detail}`);
  }
  return { path, branch };
}

/**
 * Remove a session's worktree. The branch is always preserved (ADR-7). A worktree with uncommitted
 * work is refused unless `force` is set, so edits are never discarded silently.
 */
export async function removeWorktree(
  projectPath: string,
  path: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const args = ["worktree", "remove", path];
  if (options.force === true) args.push("--force");
  try {
    await runGit(args, projectPath);
  } catch (error) {
    const detail = stderrOf(error);
    if (detail.includes("modified or untracked")) {
      throw new HttpError(
        409,
        "the session worktree has uncommitted work; commit it or delete with force=true",
      );
    }
    throw new HttpError(500, `could not remove worktree: ${detail}`);
  }
  // `git worktree remove` leaves nothing behind; this only covers a partially removed directory.
  await rm(path, { recursive: true, force: true });
}
