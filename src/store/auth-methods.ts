import type { Database } from "bun:sqlite";
import type { AuthMethod, AuthMethodId, AuthMethodType, UserId } from "../types.ts";

interface AuthMethodRow {
  id: string;
  user_id: string;
  type: string;
  provider: string;
  label: string;
  credential_ciphertext: string;
  created_at: string;
  last_used_at: string | null;
}

const toAuthMethod = (row: AuthMethodRow): AuthMethod => ({
  id: row.id as AuthMethodId,
  userId: row.user_id as UserId,
  type: row.type as AuthMethodType,
  provider: row.provider,
  label: row.label,
  credentialCiphertext: row.credential_ciphertext,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

export interface InsertAuthMethodInput {
  userId: UserId;
  type: AuthMethodType;
  provider: string;
  label: string;
  credentialCiphertext: string;
}

export function insertAuthMethod(db: Database, input: InsertAuthMethodInput): AuthMethod {
  const id = crypto.randomUUID() as AuthMethodId;
  db.query(
    `INSERT INTO auth_methods (id, user_id, type, provider, label, credential_ciphertext, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.userId,
    input.type,
    input.provider,
    input.label,
    input.credentialCiphertext,
    new Date().toISOString(),
  );
  const method = getAuthMethod(db, id);
  if (method === undefined) throw new Error(`auth method ${id} vanished after insert`);
  return method;
}

export function getAuthMethod(db: Database, id: AuthMethodId): AuthMethod | undefined {
  const row = db.query<AuthMethodRow, [string]>("SELECT * FROM auth_methods WHERE id = ?").get(id);
  return row === null ? undefined : toAuthMethod(row);
}

export function listAuthMethods(db: Database, userId: UserId): AuthMethod[] {
  return db
    .query<AuthMethodRow, [string]>(
      "SELECT * FROM auth_methods WHERE user_id = ? ORDER BY created_at ASC, id ASC",
    )
    .all(userId)
    .map(toAuthMethod);
}

/** Replace a credential after an OAuth refresh rotated the token. */
export function updateAuthMethodCredential(
  db: Database,
  id: AuthMethodId,
  credentialCiphertext: string,
): void {
  db.query("UPDATE auth_methods SET credential_ciphertext = ? WHERE id = ?").run(
    credentialCiphertext,
    id,
  );
}

export function touchAuthMethod(db: Database, id: AuthMethodId): void {
  db.query("UPDATE auth_methods SET last_used_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    id,
  );
}

/** Point a project at one of its owner's auth methods. */
export function assignAuthMethod(
  db: Database,
  projectId: string,
  authMethodId: AuthMethodId | null,
): void {
  db.query("UPDATE projects SET assigned_auth_method_id = ? WHERE id = ?").run(
    authMethodId,
    projectId,
  );
}
