import type { Database } from "bun:sqlite";

/** Ordered, append-only schema history. Never edit a shipped migration; append a new one. */
export interface Migration {
  version: number;
  statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE users (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL UNIQUE,
        token_id TEXT NOT NULL UNIQUE,
        token_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        assigned_auth_method_id TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX projects_owner ON projects(owner_id)`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        branch TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        model_provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        conversation_id TEXT,
        status TEXT NOT NULL,
        pid INTEGER,
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX sessions_project_name ON sessions(project_id, name)`,
      `CREATE INDEX sessions_project ON sessions(project_id)`,
      `CREATE TABLE message_mirror (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        entry_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, entry_id)
      )`,
      `CREATE INDEX message_mirror_order ON message_mirror(session_id, sequence)`,
      `CREATE TABLE request_dedup (
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        submission_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, request_id)
      )`,
    ],
  },
  {
    version: 3,
    statements: [
      `CREATE TABLE auth_methods (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        type TEXT NOT NULL,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        credential_ciphertext TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      )`,
      `CREATE INDEX auth_methods_user ON auth_methods(user_id)`,
    ],
  },
];

/** Apply every migration newer than the database's `user_version`. */
export function migrate(db: Database): void {
  const row = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
  const current = row?.user_version ?? 0;
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      for (const statement of migration.statements) db.exec(statement);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    })();
  }
}
