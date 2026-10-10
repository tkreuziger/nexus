import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptSecret, loadOrCreateKey } from "../../src/crypto/secrets.ts";
import { credentialHandlers } from "../../src/sessions/credentials.ts";
import { assignAuthMethod, insertAuthMethod } from "../../src/store/auth-methods.ts";
import { openStore } from "../../src/store/db.ts";
import { insertProject } from "../../src/store/projects.ts";
import type { AuthMethodId, ProjectId, Session, SessionId, UserId } from "../../src/types.ts";

let db: Database;
let secretKey: CryptoKey;
let projectId: ProjectId;
let session: Session;

const ownerId = "owner-1" as UserId;

const addMethod = async (provider: string, credential: unknown): Promise<AuthMethodId> => {
  const method = insertAuthMethod(db, {
    userId: ownerId,
    type: "api_key",
    provider,
    label: provider,
    credentialCiphertext: await encryptSecret(secretKey, JSON.stringify(credential)),
  });
  return method.id;
};

beforeEach(async () => {
  db = openStore(":memory:");
  secretKey = await loadOrCreateKey(join(mkdtempSync(join(tmpdir(), "nexus-cred-")), "key"));
  db.query(
    "INSERT INTO users (id, handle, token_id, token_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(ownerId, "owner", "tid", "hash", new Date().toISOString());
  const project = insertProject(db, { ownerId, name: "demo", path: "/tmp/demo" });
  projectId = project.id;
  session = {
    id: "session-1" as SessionId,
    projectId,
    name: "alpha",
    worktreePath: "/tmp/wt",
    branch: "pi/alpha",
    baseRef: "HEAD",
    model: { provider: "faux", modelId: "faux-1" },
    conversationId: null,
    status: "idle",
    pid: null,
    createdAt: new Date().toISOString(),
  };
});

const handlers = () => credentialHandlers(session, { db, secretKey });

describe("credentialHandlers", () => {
  test("returns no credential when the project has none assigned", async () => {
    expect(await handlers().read({ provider: "faux" })).toEqual({ credential: null });
  });

  test("decrypts the assigned credential for the matching provider", async () => {
    const id = await addMethod("faux", { type: "api_key", key: "sk-fake-placeholder" });
    assignAuthMethod(db, projectId, id);
    expect(await handlers().read({ provider: "faux" })).toEqual({
      credential: { type: "api_key", key: "sk-fake-placeholder" },
    });
  });

  test("returns no credential for a provider other than the assigned one", async () => {
    const id = await addMethod("faux", { type: "api_key", key: "sk-fake-placeholder" });
    assignAuthMethod(db, projectId, id);
    expect(await handlers().read({ provider: "openai" })).toEqual({ credential: null });
  });

  test("records last-used when a credential is handed out", async () => {
    const id = await addMethod("faux", { type: "api_key", key: "sk-fake-placeholder" });
    assignAuthMethod(db, projectId, id);
    await handlers().read({ provider: "faux" });
    const row = db
      .query<{ last_used_at: string | null }, [string]>(
        "SELECT last_used_at FROM auth_methods WHERE id = ?",
      )
      .get(id);
    expect(row?.last_used_at).not.toBeNull();
  });

  test("persists a rotated oauth credential and reads it back", async () => {
    const first = { type: "oauth" as const, refresh: "r1", access: "a1", expires: 1000 };
    const id = await addMethod("faux", first);
    assignAuthMethod(db, projectId, id);
    const rotated = { type: "oauth" as const, refresh: "r2", access: "a2", expires: 2000 };
    expect(await handlers().modify({ provider: "faux", credential: rotated })).toEqual({
      credential: rotated,
    });
    expect(await handlers().read({ provider: "faux" })).toEqual({ credential: rotated });

    const row = db
      .query<{ credential_ciphertext: string }, [string]>(
        "SELECT credential_ciphertext FROM auth_methods WHERE id = ?",
      )
      .get(id);
    // The whole JSON cannot appear in base64, whose alphabet excludes `{`, `"` and `:`.
    expect(row?.credential_ciphertext).not.toContain(JSON.stringify(rotated));
    expect(row?.credential_ciphertext?.startsWith("v1.")).toBe(true);
  });

  test("lists only the assigned method's metadata", async () => {
    expect(await handlers().list({})).toEqual({ infos: [] });
    const id = await addMethod("faux", { type: "api_key", key: "sk-fake-placeholder" });
    assignAuthMethod(db, projectId, id);
    expect(await handlers().list({})).toEqual({ infos: [{ providerId: "faux", type: "api_key" }] });
  });

  test("refuses to modify a provider that is not assigned", async () => {
    expect(
      await handlers().modify({ provider: "openai", credential: { type: "api_key", key: "x" } }),
    ).toEqual({ credential: null });
  });
});
