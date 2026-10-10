import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HttpError } from "./errors.ts";

/** One directory that can be suggested for a registration path. */
export interface FsEntry {
  name: string;
  path: string;
  /** True when the directory holds a `.git` entry, so registering it would succeed. */
  git: boolean;
}

/** The immediate subdirectories of a path, with the canonical path that was listed. */
export interface DirectoryListing {
  path: string;
  entries: FsEntry[];
}

/** A leading `~` means the server's home directory, so a typed hint still autocompletes. */
function expandUser(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

/** A `.git` entry is what a repository check would find; stat avoids spawning git per suggestion. */
async function hasGitEntry(path: string): Promise<boolean> {
  return (await stat(join(path, ".git")).catch(() => undefined)) !== undefined;
}

/**
 * List the immediate subdirectories of `requested` (the home directory when it is empty), for the
 * path autocomplete on project registration. Read-only and not owner-scoped: registering already
 * accepts any path on the server, so listing directory names grants no new capability.
 */
export async function listDirectories(requested: string, limit: number): Promise<DirectoryListing> {
  const candidate = requested === "" ? homedir() : expandUser(requested);
  const absolute = resolve(candidate);
  const info = await stat(absolute).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) {
    throw new HttpError(422, `not a directory: ${requested}`);
  }
  const real = await realpath(absolute);
  const dirents = await readdir(real, { withFileTypes: true });
  const names = dirents
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort((a, b) => a.localeCompare(b));
  const entries = await Promise.all(
    names.slice(0, limit).map(async (name) => {
      const path = join(real, name);
      return { name, path, git: await hasGitEntry(path) };
    }),
  );
  return { path: real, entries };
}
