import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** The files a `@` mention can complete against, relative to the worktree root. */
export interface WorktreeFiles {
  files: string[];
  /** True when the cap stopped the walk, so the worktree holds more than this. */
  truncated: boolean;
}

/** Directories never descended into: not source, and routinely enormous. */
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

/**
 * Every file under `root`, relative and always slash-separated, capped at `limit`.
 *
 * The list is what a `@` mention completes against, so it is fetched once and filtered in the
 * browser rather than re-walked on every keystroke. Symlinks are skipped rather than followed, so
 * the walk cannot leave the worktree, and an unreadable directory is passed over rather than
 * failing the whole listing — a permission problem deep in a tree should not empty the list.
 */
export async function listWorktreeFiles(root: string, limit: number): Promise<WorktreeFiles> {
  const files: string[] = [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) return;
    const dirents = await readdir(dir, { withFileTypes: true }).catch(() => []);
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of dirents) {
      if (truncated) return;
      if (dirent.isSymbolicLink()) continue;
      // Checked by name rather than by kind: in a worktree `.git` is a file holding a gitdir
      // pointer, not a directory, and listing it as a file would be noise in every completion.
      if (SKIPPED_DIRECTORIES.has(dirent.name)) continue;
      const path = join(dir, dirent.name);
      if (dirent.isDirectory()) {
        await walk(path);
        continue;
      }
      // Anything that is not a regular file is skipped: sockets, devices, fifos.
      if (!dirent.isFile()) continue;
      files.push(relative(root, path).split(sep).join("/"));
      if (files.length >= limit) {
        truncated = true;
        return;
      }
    }
  }

  await walk(root);
  return { files, truncated };
}
