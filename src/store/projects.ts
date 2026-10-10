import type { Database } from "bun:sqlite";
import type { AuthMethodId, ModelRef, Project, ProjectId, UserId } from "../types.ts";

interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  path: string;
  assigned_auth_method_id: string | null;
  default_model_provider: string | null;
  default_model_id: string | null;
  created_at: string;
}

const toProject = (row: ProjectRow): Project => ({
  id: row.id as ProjectId,
  ownerId: row.owner_id as UserId,
  name: row.name,
  path: row.path,
  assignedAuthMethodId: row.assigned_auth_method_id as AuthMethodId | null,
  defaultModel:
    row.default_model_provider === null || row.default_model_id === null
      ? null
      : { provider: row.default_model_provider, modelId: row.default_model_id },
  createdAt: row.created_at,
});

/** Insert a project row. Throws `SQLiteError` on a duplicate path; the registry maps that to 409. */
export function insertProject(
  db: Database,
  input: { ownerId: UserId; name: string; path: string },
): Project {
  const id = crypto.randomUUID() as ProjectId;
  const createdAt = new Date().toISOString();
  db.query(
    "INSERT INTO projects (id, owner_id, name, path, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, input.ownerId, input.name, input.path, createdAt);
  return {
    id,
    ownerId: input.ownerId,
    name: input.name,
    path: input.path,
    assignedAuthMethodId: null,
    defaultModel: null,
    createdAt,
  };
}

/** List one owner's projects, newest first. */
export function listProjects(db: Database, ownerId: UserId): Project[] {
  return db
    .query<ProjectRow, [string]>(
      "SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at DESC, id DESC",
    )
    .all(ownerId)
    .map(toProject);
}

/** Fetch a project only when `ownerId` owns it, so ownership is enforced in the query. */
export function getProject(db: Database, id: ProjectId, ownerId: UserId): Project | undefined {
  const row = db
    .query<ProjectRow, [string, string]>("SELECT * FROM projects WHERE id = ? AND owner_id = ?")
    .get(id, ownerId);
  return row === null ? undefined : toProject(row);
}

/** Look up a project by its absolute path, regardless of owner, to detect duplicate registration. */
export function findProjectByPath(db: Database, path: string): Project | undefined {
  const row = db.query<ProjectRow, [string]>("SELECT * FROM projects WHERE path = ?").get(path);
  return row === null ? undefined : toProject(row);
}

/** Look up a project by id without an owner check, for server-internal orchestration. */
export function getProjectById(db: Database, id: ProjectId): Project | undefined {
  const row = db.query<ProjectRow, [string]>("SELECT * FROM projects WHERE id = ?").get(id);
  return row === null ? undefined : toProject(row);
}

/** Point a project at the model a new session defaults to; `null` clears it. */
export function setProjectDefaultModel(db: Database, id: ProjectId, model: ModelRef | null): void {
  db.query("UPDATE projects SET default_model_provider = ?, default_model_id = ? WHERE id = ?").run(
    model?.provider ?? null,
    model?.modelId ?? null,
    id,
  );
}
