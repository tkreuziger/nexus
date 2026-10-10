import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Repository state for a project: branch, dirty paths, and divergence from upstream. */
export interface GitStatus {
  branch: string;
  dirty: string[];
  ahead: number;
  behind: number;
}

export interface GitLogEntry {
  sha: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitWorktree {
  path: string;
  branch: string | null;
  head: string | null;
  detached: boolean;
}

/** Run `git` with an argv array (never a shell) inside `cwd` and return stdout. */
export async function runGit(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

function pathOf(line: string): string {
  const type = line[0];
  if (type === "?" || type === "!") return line.slice(2);
  const parts = line.split(" ");
  return parts.slice(type === "2" ? 9 : type === "u" ? 10 : 8).join(" ");
}

/** Parse `git status --porcelain=v2 --branch` output. */
export function parseStatus(output: string): GitStatus {
  const status: GitStatus = { branch: "(unknown)", dirty: [], ahead: 0, behind: 0 };
  for (const line of output.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      status.branch = line.slice("# branch.head ".length).trim();
    } else if (line.startsWith("# branch.ab ")) {
      const [ahead, behind] = line.slice("# branch.ab ".length).trim().split(" ");
      status.ahead = Number.parseInt((ahead ?? "+0").slice(1), 10);
      status.behind = Number.parseInt((behind ?? "-0").slice(1), 10);
    } else if (line !== "" && !line.startsWith("#")) {
      status.dirty.push(pathOf(line));
    }
  }
  status.dirty.sort();
  return status;
}

/** True when `path` is itself the top level of a git repository (not a subdirectory of one). */
export async function isGitRepository(path: string): Promise<boolean> {
  const top = await runGit(["rev-parse", "--show-toplevel"], path).catch(() => undefined);
  if (top === undefined) return false;
  const [topReal, pathReal] = await Promise.all([realpath(top.trim()), realpath(path)]);
  return topReal === pathReal;
}

/** Read-only repository state. */
export async function gitStatus(path: string): Promise<GitStatus> {
  return parseStatus(await runGit(["status", "--porcelain=v2", "--branch"], path));
}

/** Recent commits, newest first. */
export async function gitLog(path: string, limit: number): Promise<GitLogEntry[]> {
  const output = await runGit(
    ["log", `-n${limit}`, "--pretty=format:%H\x1f%an\x1f%aI\x1f%s"],
    path,
  ).catch(() => "");
  return output
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [sha, author, date, subject] = line.split("\x1f");
      return { sha: sha ?? "", author: author ?? "", date: date ?? "", subject: subject ?? "" };
    });
}

/** Every worktree linked to the repository, including the main checkout. */
export async function gitWorktrees(path: string): Promise<GitWorktree[]> {
  const output = await runGit(["worktree", "list", "--porcelain"], path);
  return output
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const fields = new Map(
        block
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => {
            const separator = line.indexOf(" ");
            return separator === -1
              ? [line, ""]
              : [line.slice(0, separator), line.slice(separator + 1)];
          }),
      );
      const branch = fields.get("branch");
      return {
        path: fields.get("worktree") ?? "",
        branch: branch === undefined ? null : branch.replace("refs/heads/", ""),
        head: fields.get("HEAD") ?? null,
        detached: fields.has("detached"),
      };
    });
}
