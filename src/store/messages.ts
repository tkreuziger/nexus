import type { Database } from "bun:sqlite";
import type { MessageMirrorRow, MessageRole, SessionId } from "../types.ts";

interface MirrorRow {
  session_id: string;
  entry_id: string;
  sequence: number;
  role: string;
  content: string;
  created_at: string;
}

const toRow = (row: MirrorRow): MessageMirrorRow => ({
  sessionId: row.session_id as SessionId,
  sequence: row.sequence,
  entryId: row.entry_id,
  role: row.role as MessageRole,
  content: row.content,
  createdAt: row.created_at,
});

export interface MirrorEntryInput {
  sessionId: SessionId;
  entryId: string;
  role: MessageRole;
  content: string;
}

/**
 * Append one mirrored entry, assigning the next sequence for the session. Idempotent by
 * `(session_id, entry_id)`, so a harness restart that re-reads history cannot duplicate rows.
 * Returns false when the entry was already mirrored.
 */
export function appendMirrorEntry(db: Database, input: MirrorEntryInput): boolean {
  return db.transaction(() => {
    const existing = db
      .query<{ present: number }, [string, string]>(
        "SELECT 1 AS present FROM message_mirror WHERE session_id = ? AND entry_id = ?",
      )
      .get(input.sessionId, input.entryId);
    if (existing !== null) return false;
    const next = db
      .query<{ sequence: number }, [string]>(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM message_mirror WHERE session_id = ?",
      )
      .get(input.sessionId);
    db.query(
      `INSERT INTO message_mirror (session_id, entry_id, sequence, role, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      input.sessionId,
      input.entryId,
      next?.sequence ?? 1,
      input.role,
      input.content,
      new Date().toISOString(),
    );
    return true;
  })();
}

/** The mirrored transcript in commit order — the full history, independent of Pi Durable compaction. */
export function listMessages(
  db: Database,
  sessionId: SessionId,
  limit: number,
): MessageMirrorRow[] {
  return db
    .query<MirrorRow, [string, number]>(
      "SELECT * FROM message_mirror WHERE session_id = ? ORDER BY sequence ASC LIMIT ?",
    )
    .all(sessionId, limit)
    .map(toRow);
}

export function countMessages(db: Database, sessionId: SessionId): number {
  const row = db
    .query<{ count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM message_mirror WHERE session_id = ?",
    )
    .get(sessionId);
  return row?.count ?? 0;
}

/** Record the submission id chosen for a client request id, so a retry answers without a round trip. */
export function recordRequest(
  db: Database,
  sessionId: SessionId,
  requestId: string,
  submissionId: string,
): void {
  db.query(
    `INSERT INTO request_dedup (session_id, request_id, submission_id, created_at)
     VALUES (?, ?, ?, ?) ON CONFLICT (session_id, request_id) DO NOTHING`,
  ).run(sessionId, requestId, submissionId, new Date().toISOString());
}

/** Look up the submission a client request id already produced. */
export function findRequest(
  db: Database,
  sessionId: SessionId,
  requestId: string,
): string | undefined {
  const row = db
    .query<{ submission_id: string }, [string, string]>(
      "SELECT submission_id FROM request_dedup WHERE session_id = ? AND request_id = ?",
    )
    .get(sessionId, requestId);
  return row?.submission_id;
}
