import type { Database } from "bun:sqlite";
import type { User, UserId } from "../types.ts";

interface UserRow {
  id: string;
  handle: string;
  token_id: string;
  token_hash: string;
  created_at: string;
}

/** Bearer tokens are `<tokenId>_<secret>`: the id selects the row, the secret is verified against its hash. */
export const TOKEN_PREFIX = "nx";

const toUser = (row: UserRow): User => ({
  id: row.id as UserId,
  handle: row.handle,
  createdAt: row.created_at,
});

/** Register a user and store the hash of `secret` under a fresh token id. Returns the full bearer token. */
export async function createUser(
  db: Database,
  handle: string,
  secret: string,
): Promise<{ user: User; token: string }> {
  const id = crypto.randomUUID() as UserId;
  const tokenId = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const token = `${TOKEN_PREFIX}_${tokenId}_${secret}`;
  const tokenHash = await Bun.password.hash(secret);
  db.query(
    "INSERT INTO users (id, handle, token_id, token_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, handle, tokenId, tokenHash, new Date().toISOString());
  return { user: { id, handle, createdAt: new Date().toISOString() }, token };
}

/** Resolve a bearer token to its user, or `undefined` when the token is malformed or the secret is wrong. */
export async function authenticate(db: Database, token: string): Promise<User | undefined> {
  const parts = token.split("_");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return undefined;
  const [, tokenId, secret] = parts as [string, string, string];
  const row = db.query<UserRow, [string]>("SELECT * FROM users WHERE token_id = ?").get(tokenId);
  if (row === null || !(await Bun.password.verify(secret, row.token_hash))) return undefined;
  return toUser(row);
}

/** Look up a user by id. */
export function getUser(db: Database, id: UserId): User | undefined {
  const row = db.query<UserRow, [string]>("SELECT * FROM users WHERE id = ?").get(id);
  return row === null ? undefined : toUser(row);
}
