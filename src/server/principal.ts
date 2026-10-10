import type { Database } from "bun:sqlite";
import { authenticate } from "../store/users.ts";
import type { User } from "../types.ts";

/** Extract a bearer token from the `Authorization` header. */
export function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (header === null || !header.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token === "" ? undefined : token;
}

/** Resolve the request's user, or `undefined` when the token is absent or invalid. */
export async function resolveUser(db: Database, request: Request): Promise<User | undefined> {
  const token = bearerToken(request);
  return token === undefined ? undefined : authenticate(db, token);
}
