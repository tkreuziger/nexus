import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** One content match inside a project file, with 1-based line and column. */
export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

/** A capped set of matches. `truncated` means the cap stopped the walk, so more may exist. */
export interface SearchResult {
  matches: SearchMatch[];
  truncated: boolean;
}

/** Directories never descended into: not source, and often enormous. */
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

/** Files larger than this are skipped rather than read into memory. */
const MAX_FILE_BYTES = 1_048_576;

/** A long minified line is useful to identify but not to print in full. */
const MAX_LINE_LENGTH = 400;

/**
 * Search file contents under `root`, case-insensitively, returning at most `limit` matches.
 * Read-only and path-contained: symlinks are skipped rather than followed, so nothing outside the
 * root can be read. Binary files and files over `MAX_FILE_BYTES` are skipped.
 */
export async function searchProject(
  root: string,
  query: string,
  limit: number,
): Promise<SearchResult> {
  const rootReal = await realpath(root);
  const needle = query.toLowerCase();
  const matches: SearchMatch[] = [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) return;
    const dirents = await readdir(dir, { withFileTypes: true });
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of dirents) {
      if (truncated) return;
      const path = join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(dirent.name)) continue;
        await walk(path);
        continue;
      }
      // Anything that is not a regular file is skipped: symlinks, sockets, devices.
      if (!dirent.isFile()) continue;
      const info = await stat(path);
      if (info.size > MAX_FILE_BYTES) continue;
      const buffer = await readFile(path);
      if (buffer.includes(0)) continue;
      const relativePath = relative(rootReal, path).split(sep).join("/");
      const lines = buffer.toString("utf8").split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const text = lines[index] ?? "";
        const column = text.toLowerCase().indexOf(needle);
        if (column === -1) continue;
        matches.push({
          path: relativePath,
          line: index + 1,
          column: column + 1,
          text: text.length > MAX_LINE_LENGTH ? text.slice(0, MAX_LINE_LENGTH) : text,
        });
        if (matches.length >= limit) {
          truncated = true;
          return;
        }
      }
    }
  }

  await walk(rootReal);
  return { matches, truncated };
}
