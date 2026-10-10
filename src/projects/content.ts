import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { HttpError } from "../errors.ts";

/** One entry in a directory listing, with its path relative to the project root. */
export interface ContentEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

/** Result of a read-only content request: a directory listing or a file's text. */
export type ContentResult =
  | { kind: "directory"; path: string; entries: ContentEntry[] }
  | { kind: "file"; path: string; size: number; text: string };

const isWithin = (root: string, target: string) => target === root || target.startsWith(root + sep);

/**
 * Resolve `requested` against `root`, refusing anything that escapes the root once symlinks are
 * followed. Throws `HttpError` 400 on escape and 404 when the path does not exist.
 */
async function resolveContained(
  root: string,
  requested: string,
): Promise<{ root: string; path: string }> {
  const rootReal = await realpath(root);
  const lexical = resolve(rootReal, requested);
  if (!isWithin(rootReal, lexical)) {
    throw new HttpError(400, "path escapes the project root");
  }
  const real = await realpath(lexical).catch(() => undefined);
  if (real === undefined) {
    throw new HttpError(404, `no such path: ${requested}`);
  }
  if (!isWithin(rootReal, real)) {
    throw new HttpError(400, "path escapes the project root");
  }
  return { root: rootReal, path: real };
}

async function listDirectory(root: string, path: string): Promise<ContentResult> {
  const dirents = await readdir(path, { withFileTypes: true });
  const entries = dirents.map((dirent) => ({
    name: dirent.name,
    path: relative(root, resolve(path, dirent.name)),
    type: dirent.isDirectory() ? ("directory" as const) : ("file" as const),
  }));
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { kind: "directory", path: relative(root, path), entries };
}

/** Read a file or list a directory inside `root`. Read-only; never escapes the root. */
export async function readProjectContent(root: string, requested: string): Promise<ContentResult> {
  const resolved = await resolveContained(root, requested);
  const info = await stat(resolved.path);
  if (info.isDirectory()) {
    return listDirectory(resolved.root, resolved.path);
  }
  return {
    kind: "file",
    path: relative(resolved.root, resolved.path),
    size: info.size,
    text: await readFile(resolved.path, "utf8"),
  };
}
