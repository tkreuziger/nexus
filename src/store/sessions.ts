import type { Database } from "bun:sqlite";
import type { ModelRef, ProjectId, Session, SessionId, SessionStatus } from "../types.ts";

interface SessionRow {
  id: string;
  project_id: string;
  name: string;
  worktree_path: string;
  branch: string;
  base_ref: string;
  model_provider: string;
  model_id: string;
  conversation_id: string | null;
  status: string;
  pid: number | null;
  created_at: string;
}

const toSession = (row: SessionRow): Session => ({
  id: row.id as SessionId,
  projectId: row.project_id as ProjectId,
  name: row.name,
  worktreePath: row.worktree_path,
  branch: row.branch,
  baseRef: row.base_ref,
  model: { provider: row.model_provider, modelId: row.model_id },
  conversationId: row.conversation_id,
  status: row.status as SessionStatus,
  pid: row.pid,
  createdAt: row.created_at,
});

export interface InsertSessionInput {
  id: SessionId;
  projectId: ProjectId;
  name: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  model: ModelRef;
}

/** Record a session. Throws `SQLiteError` when the project already has a session with that name. */
export function insertSession(db: Database, input: InsertSessionInput): Session {
  db.query(
    `INSERT INTO sessions
       (id, project_id, name, worktree_path, branch, base_ref, model_provider, model_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'starting', ?)`,
  ).run(
    input.id,
    input.projectId,
    input.name,
    input.worktreePath,
    input.branch,
    input.baseRef,
    input.model.provider,
    input.model.modelId,
    new Date().toISOString(),
  );
  const session = getSession(db, input.id);
  if (session === undefined) throw new Error(`session ${input.id} vanished after insert`);
  return session;
}

export function getSession(db: Database, id: SessionId): Session | undefined {
  const row = db.query<SessionRow, [string]>("SELECT * FROM sessions WHERE id = ?").get(id);
  return row === null ? undefined : toSession(row);
}

export function listSessions(db: Database, projectId: ProjectId): Session[] {
  return db
    .query<SessionRow, [string]>(
      "SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at ASC, id ASC",
    )
    .all(projectId)
    .map(toSession);
}

/** Every session still believed to be running, across all projects, for boot-time reconciliation. */
export function listLiveSessions(db: Database): Session[] {
  return db
    .query<SessionRow, []>("SELECT * FROM sessions WHERE status IN ('starting', 'idle', 'running')")
    .all()
    .map(toSession);
}

export function setSessionStatus(
  db: Database,
  id: SessionId,
  status: SessionStatus,
  pid: number | null,
): void {
  db.query("UPDATE sessions SET status = ?, pid = ? WHERE id = ?").run(status, pid, id);
}

export function setSessionConversation(db: Database, id: SessionId, conversationId: string): void {
  db.query("UPDATE sessions SET conversation_id = ? WHERE id = ?").run(conversationId, id);
}

export function deleteSession(db: Database, id: SessionId): void {
  db.transaction(() => {
    db.query("DELETE FROM message_mirror WHERE session_id = ?").run(id);
    db.query("DELETE FROM request_dedup WHERE session_id = ?").run(id);
    db.query("DELETE FROM sessions WHERE id = ?").run(id);
  })();
}
