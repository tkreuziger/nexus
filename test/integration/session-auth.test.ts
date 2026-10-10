import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_PREFIX } from "@nexus/client";
import { ModelCatalog } from "../../src/catalog.ts";
import type { Config } from "../../src/config.ts";
import { loadOrCreateKey } from "../../src/crypto/secrets.ts";
import { createApp } from "../../src/server/app.ts";
import { SessionSupervisor } from "../../src/sessions/supervisor.ts";
import { openStore } from "../../src/store/db.ts";
import { createUser } from "../../src/store/users.ts";

let db: Database;
let app: (request: Request) => Promise<Response>;
let token: string;

const withHeaders = (bearer?: string, json = false): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (json) headers["content-type"] = "application/json";
  if (bearer !== undefined) headers.authorization = `Bearer ${bearer}`;
  return headers;
};

const post = (path: string, body: unknown, bearer?: string) =>
  app(
    new Request(`http://localhost${API_PREFIX}${path}`, {
      method: "POST",
      headers: withHeaders(bearer, true),
      body: JSON.stringify(body),
    }),
  );

const get = (path: string, bearer?: string) =>
  app(new Request(`http://localhost${API_PREFIX}${path}`, { headers: withHeaders(bearer) }));

const jsonOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

beforeEach(async () => {
  db = openStore(":memory:");
  const base = mkdtempSync(join(tmpdir(), "nexus-login-"));
  const config: Config = {
    projectsRoot: base,
    worktreesRoot: base,
    dataDir: base,
    piStorageDir: join(base, "sessions"),
    listen: { host: "127.0.0.1", port: 0 },
    secretKeyFile: join(base, "secret.key"),
    defaultModel: null,
    bootstrapToken: null,
    webDir: null,
    sseHeartbeatMs: 50,
    compaction: { reserveTokens: 16_384, keepRecentTokens: 20_000 },
  };
  const secretKey = await loadOrCreateKey(config.secretKeyFile);
  app = createApp({
    db,
    config,
    supervisor: new SessionSupervisor(db, config, secretKey),
    secretKey,
    catalog: new ModelCatalog(),
  });
  token = (await createUser(db, "owner", "s3cret")).token;
});

describe("POST /login", () => {
  test("runs without a bearer token and returns a token that authenticates", async () => {
    const response = await post("/login", { handle: "owner", secret: "s3cret" });
    expect(response.status).toBe(200);
    const body = await jsonOf<{ token: string; user: { handle: string } }>(response);
    expect(body.user.handle).toBe("owner");

    // The returned token is the same bearer token the account was created with, because it is
    // reconstructed from the stored id rather than recovered from a hash.
    expect(body.token).toBe(token);

    const projects = await get("/projects", body.token);
    expect(projects.status).toBe(200);
  });

  test("rejects an unknown handle", async () => {
    const response = await post("/login", { handle: "nobody", secret: "s3cret" });
    expect(response.status).toBe(401);
    expect(await jsonOf<{ error: { message: string } }>(response)).toEqual({
      error: { message: "invalid handle or secret" },
    });
  });

  test("rejects a wrong secret", async () => {
    expect((await post("/login", { handle: "owner", secret: "wrong" })).status).toBe(401);
  });

  test("requires both fields", async () => {
    expect((await post("/login", { handle: "owner" })).status).toBe(400);
    expect((await post("/login", { secret: "s3cret" })).status).toBe(400);
  });

  test("is the only route that skips authentication", async () => {
    // Every other route still refuses an anonymous caller.
    for (const path of ["/projects", "/auth-methods", "/me"]) {
      expect((await get(path)).status).toBe(401);
    }
    expect((await post("/projects", { path: "/tmp" })).status).toBe(401);
  });
});

describe("GET /me", () => {
  test("returns the authenticated user", async () => {
    const response = await get("/me", token);
    expect(response.status).toBe(200);
    const body = await jsonOf<{ user: { id: string; handle: string } }>(response);
    expect(body.user.handle).toBe("owner");
    expect(body.user.id).toBeString();
  });

  test("refuses an invalid token", async () => {
    expect((await get("/me", "nx_dead_beef")).status).toBe(401);
  });
});

describe("user secrets", () => {
  test("refuses a secret containing an underscore", async () => {
    // `authenticate` splits a bearer token on `_` and requires exactly three parts, so a secret with
    // an underscore would produce a token that can never authenticate.
    await expect(createUser(db, "other", "a_b")).rejects.toThrow(/underscore/);
  });
});
