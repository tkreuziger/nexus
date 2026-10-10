import type { Database } from "bun:sqlite";
import { realpath, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { HttpError } from "../errors.ts";
import { findProjectByPath, getProject, insertProject } from "../store/projects.ts";
import type { Project, ProjectId, UserId } from "../types.ts";
import { isGitRepository } from "./git.ts";

/** Validate a registration request: the path must be an existing directory that is itself a git repo. */
async function resolveRegisterable(requested: string): Promise<string> {
  const absolute = resolve(requested);
  const info = await stat(absolute).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) {
    throw new HttpError(422, `not a directory: ${requested}`);
  }
  if (!(await isGitRepository(absolute))) {
    throw new HttpError(422, `not a git repository: ${requested}`);
  }
  return realpath(absolute);
}

/** Register a folder as a project owned by `ownerId`. Duplicate paths are rejected with 409. */
export async function registerProject(
  db: Database,
  ownerId: UserId,
  input: { path: string; name?: string | undefined },
): Promise<Project> {
  const path = await resolveRegisterable(input.path);
  if (findProjectByPath(db, path) !== undefined) {
    throw new HttpError(409, `already registered: ${path}`);
  }
  try {
    return insertProject(db, { ownerId, name: input.name ?? basename(path), path });
  } catch (error) {
    // The UNIQUE constraint is the real guard; the check above only produces a better message.
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      throw new HttpError(409, `already registered: ${path}`);
    }
    throw error;
  }
}

/** Fetch a project the caller owns, or throw 404 — never revealing that another user's project exists. */
export function requireProject(db: Database, id: ProjectId, ownerId: UserId): Project {
  const project = getProject(db, id, ownerId);
  if (project === undefined) throw new HttpError(404, `no such project: ${id}`);
  return project;
}
