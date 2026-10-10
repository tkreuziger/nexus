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
