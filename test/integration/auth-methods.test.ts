import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_PREFIX } from "@nexus/client";
import type { Config } from "../../src/config.ts";
import { loadOrCreateKey } from "../../src/crypto/secrets.ts";
import { runGit } from "../../src/projects/git.ts";
import { createApp } from "../../src/server/app.ts";
import { SessionSupervisor } from "../../src/sessions/supervisor.ts";
import { openStore } from "../../src/store/db.ts";
import { createUser } from "../../src/store/users.ts";

let db: Database;
let config: Config;
let app: (request: Request) => Promise<Response>;
let token: string;
let otherToken: string;
let base: string;

const makeRepo = async (name: string): Promise<string> => {
  const path = join(base, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "README.md"), "# hi\n");
  await runGit(["init", "-b", "main"], path);
  await runGit(["add", "."], path);
  await runGit(
    ["-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-m", "init"],
    path,
  );
  return path;
};

const call = (path: string, init: RequestInit = {}, bearer = token) =>
  app(
    new Request(`http://localhost${API_PREFIX}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    }),
  );

const jsonOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const createMethod = (body: Record<string, unknown>, bearer = token) =>
  call("/auth-methods", { method: "POST", body: JSON.stringify(body) }, bearer);

const registerProject = async (): Promise<string> => {
  const path = await makeRepo("repo");
  const body = await jsonOf<{ project: { id: string } }>(
    await call("/projects", { method: "POST", body: JSON.stringify({ path }) }),
  );
  return body.project.id;
};

beforeEach(async () => {
  db = openStore(":memory:");
  base = mkdtempSync(join(tmpdir(), "nexus-auth-"));
  config = {
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
  });
  token = (await createUser(db, "owner", "secret-one")).token;
  otherToken = (await createUser(db, "intruder", "secret-two")).token;
});

describe("auth method routes", () => {
  test("stores an api key and never returns its material", async () => {
    const response = await createMethod({
      type: "api_key",
      provider: "faux",
      label: "Faux",
      key: "sk-fake-placeholder",
    });
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(text).not.toContain("sk-fake-placeholder");
    const body = JSON.parse(text) as {
      authMethod: { provider: string; label: string; type: string };
    };
    expect(body.authMethod).toMatchObject({ provider: "faux", label: "Faux", type: "api_key" });
  });

  test("stores the credential encrypted at rest", async () => {
    await createMethod({ type: "api_key", provider: "faux", key: "sk-fake-placeholder" });
    const row = db
      .query<{ credential_ciphertext: string }, []>(
        "SELECT credential_ciphertext FROM auth_methods",
      )
      .get();
    expect(row?.credential_ciphertext).not.toContain("sk-fake-placeholder");
    expect(row?.credential_ciphertext?.startsWith("v1.")).toBe(true);
  });

  test("stores an oauth credential", async () => {
    const response = await createMethod({
      type: "oauth",
      provider: "anthropic",
      label: "Subscription",
      credential: { refresh: "r", access: "a", expires: 1_800_000_000_000 },
    });
    expect(response.status).toBe(201);
  });

  test("rejects an unknown type", async () => {
    expect((await createMethod({ type: "cookie", provider: "faux" })).status).toBe(400);
  });

  test("rejects an api key without a key", async () => {
    expect((await createMethod({ type: "api_key", provider: "faux" })).status).toBe(400);
  });

  test("rejects an oauth credential missing its token fields", async () => {
    const response = await createMethod({
      type: "oauth",
      provider: "faux",
      credential: { refresh: "r" },
    });
    expect(response.status).toBe(400);
  });

  test("lists only the caller's methods", async () => {
    await createMethod({ type: "api_key", provider: "faux", key: "sk-fake-placeholder" });
    await createMethod(
      { type: "api_key", provider: "openai", key: "sk-fake-placeholder" },
      otherToken,
    );
    const mine = await jsonOf<{ authMethods: { provider: string }[] }>(await call("/auth-methods"));
    expect(mine.authMethods.map((method) => method.provider)).toEqual(["faux"]);
    const theirs = await jsonOf<{ authMethods: { provider: string }[] }>(
      await call("/auth-methods", {}, otherToken),
    );
    expect(theirs.authMethods.map((method) => method.provider)).toEqual(["openai"]);
  });

  test("assigns an owned method to a project", async () => {
    const projectId = await registerProject();
    const created = await jsonOf<{ authMethod: { id: string } }>(
      await createMethod({ type: "api_key", provider: "faux", key: "sk-fake-placeholder" }),
    );
    const response = await call(`/projects/${projectId}/auth-method`, {
      method: "PUT",
      body: JSON.stringify({ authMethodId: created.authMethod.id }),
    });
    expect(response.status).toBe(200);
    const body = await jsonOf<{ project: { assignedAuthMethodId: string } }>(response);
    expect(body.project.assignedAuthMethodId).toBe(created.authMethod.id);
  });

  test("unassigns with a null auth method id", async () => {
    const projectId = await registerProject();
    const created = await jsonOf<{ authMethod: { id: string } }>(
      await createMethod({ type: "api_key", provider: "faux", key: "sk-fake-placeholder" }),
    );
    await call(`/projects/${projectId}/auth-method`, {
      method: "PUT",
      body: JSON.stringify({ authMethodId: created.authMethod.id }),
    });
    const body = await jsonOf<{ project: { assignedAuthMethodId: string | null } }>(
      await call(`/projects/${projectId}/auth-method`, {
        method: "PUT",
        body: JSON.stringify({ authMethodId: null }),
      }),
    );
    expect(body.project.assignedAuthMethodId).toBeNull();
  });

  test("hides another user's method behind 404", async () => {
    const projectId = await registerProject();
    const created = await jsonOf<{ authMethod: { id: string } }>(
      await createMethod(
        { type: "api_key", provider: "openai", key: "sk-fake-placeholder" },
        otherToken,
      ),
    );
    const response = await call(`/projects/${projectId}/auth-method`, {
      method: "PUT",
      body: JSON.stringify({ authMethodId: created.authMethod.id }),
    });
    expect(response.status).toBe(404);
  });

  test("deletes a method and clears the project assignment", async () => {
    const projectId = await registerProject();
    const created = await jsonOf<{ authMethod: { id: string } }>(
      await createMethod({ type: "api_key", provider: "faux", key: "sk-fake-placeholder" }),
    );
    await call(`/projects/${projectId}/auth-method`, {
      method: "PUT",
      body: JSON.stringify({ authMethodId: created.authMethod.id }),
    });
    expect(
      (await call(`/auth-methods/${created.authMethod.id}`, { method: "DELETE" })).status,
    ).toBe(200);
    const body = await jsonOf<{ project: { assignedAuthMethodId: string | null } }>(
      await call(`/projects/${projectId}`),
    );
    expect(body.project.assignedAuthMethodId).toBeNull();
  });

  test("hides another user's method from deletion", async () => {
    const created = await jsonOf<{ authMethod: { id: string } }>(
      await createMethod(
        { type: "api_key", provider: "openai", key: "sk-fake-placeholder" },
        otherToken,
      ),
    );
    expect(
      (await call(`/auth-methods/${created.authMethod.id}`, { method: "DELETE" })).status,
    ).toBe(404);
  });
});
