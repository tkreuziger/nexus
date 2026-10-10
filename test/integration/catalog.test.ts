import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListModelsResponse, ListProvidersResponse } from "@nexus/client";
import { API_PREFIX } from "@nexus/client";
import { ModelCatalog } from "../../src/catalog.ts";
import type { Config } from "../../src/config.ts";
import { loadOrCreateKey } from "../../src/crypto/secrets.ts";
import { runGit } from "../../src/projects/git.ts";
import { createApp } from "../../src/server/app.ts";
import { SessionSupervisor } from "../../src/sessions/supervisor.ts";
import { openStore } from "../../src/store/db.ts";
import { createUser } from "../../src/store/users.ts";
import type { SessionId } from "../../src/types.ts";

const FAUX_MODULE = join(import.meta.dir, "..", "fixtures", "faux-provider.ts");

let db: Database;
let config: Config;
let app: (request: Request) => Promise<Response>;
let supervisor: SessionSupervisor;
let token: string;
let base: string;
let created: SessionId[];

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

const registerProject = async (): Promise<string> => {
  const path = await makeRepo("repo");
  const body = await jsonOf<{ project: { id: string } }>(
    await call("/projects", { method: "POST", body: JSON.stringify({ path }) }),
  );
  return body.project.id;
};

/** A project with an API-key method assigned and ready for a session. */
const readyProject = async (): Promise<string> => {
  const projectId = await registerProject();
  const method = await jsonOf<{ authMethod: { id: string } }>(
    await call("/auth-methods", {
      method: "POST",
      body: JSON.stringify({ type: "api_key", provider: "faux", key: "sk-x" }),
    }),
  );
  await call(`/projects/${projectId}/auth-method`, {
    method: "PUT",
    body: JSON.stringify({ authMethodId: method.authMethod.id }),
  });
  return projectId;
};

const createSession = (projectId: string, body: unknown): Promise<Response> =>
  call(`/projects/${projectId}/sessions`, { method: "POST", body: JSON.stringify(body) });

beforeEach(async () => {
  db = openStore(":memory:");
  base = mkdtempSync(join(tmpdir(), "nexus-catalog-"));
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
  supervisor = new SessionSupervisor(db, config, secretKey);
  app = createApp({ db, config, supervisor, secretKey, catalog: new ModelCatalog() });
  token = (await createUser(db, "owner", "secret-one")).token;
  created = [];
  // The catalogue offers what Pi knows, so the fixture provider is registered as a harness would.
  process.env.NEXUS_PROVIDERS_MODULE = FAUX_MODULE;
  process.env.NEXUS_FAUX_REPLY = "hello from faux";
});

afterEach(async () => {
  for (const id of created) await supervisor.stop(id).catch(() => undefined);
});

describe("the provider catalogue", () => {
  test("lists providers with the auth each one accepts", async () => {
    const body = await jsonOf<ListProvidersResponse>(await call("/providers"));

    const faux = body.providers.find((provider) => provider.id === "faux");
    expect(faux).toMatchObject({ id: "faux", name: "faux", modelCount: 1 });
    expect(faux?.apiKey).toEqual({ name: "Faux" });
    expect(faux?.oauth).toBeNull();

    // A provider that offers both, so a client can tell the two apart rather than assume.
    const anthropic = body.providers.find((provider) => provider.id === "anthropic");
    expect(anthropic?.apiKey?.name).toBeString();
    expect(anthropic?.oauth?.name).toBeString();

    const names = body.providers.map((provider) => provider.name);
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)));
  });

  test("lists a provider's models with their metadata", async () => {
    const body = await jsonOf<ListModelsResponse>(await call("/providers/faux/models"));
    expect(body.models).toHaveLength(1);
    expect(body.models[0]).toMatchObject({
      id: "faux-1",
      name: "faux-1",
      contextWindow: expect.any(Number),
      maxTokens: expect.any(Number),
      reasoning: expect.any(Boolean),
    });
    expect(body.models[0]?.cost).toMatchObject({ input: expect.any(Number) });
  });

  test("answers 404 for a provider Pi does not know", async () => {
    const response = await call("/providers/made-up/models");
    expect(response.status).toBe(404);
    expect((await jsonOf<{ error: { message: string } }>(response)).error.message).toContain(
      "no such provider",
    );
  });

  test("requires a token", async () => {
    expect((await call("/providers", {}, "nx_dead_beef")).status).toBe(401);
  });
});

describe("validating against the catalogue", () => {
  test("refuses an auth method for a provider Pi does not know", async () => {
    const response = await call("/auth-methods", {
      method: "POST",
      body: JSON.stringify({ type: "api_key", provider: "anthopic", key: "sk-x" }),
    });
    expect(response.status).toBe(400);
    expect((await jsonOf<{ error: { message: string } }>(response)).error.message).toBe(
      'unknown provider "anthopic"',
    );
  });

  test("refuses an auth type the provider does not accept", async () => {
    // The fixture provider is API-key only, so an OAuth method is refused rather than stored and
    // discovered when a session first tries to use it.
    const response = await call("/auth-methods", {
      method: "POST",
      body: JSON.stringify({
        type: "oauth",
        provider: "faux",
        credential: { refresh: "r", access: "a", expires: 1 },
      }),
    });
    expect(response.status).toBe(400);
    expect((await jsonOf<{ error: { message: string } }>(response)).error.message).toBe(
      'provider "faux" does not accept oauth auth',
    );
  });

  test("accepts a method for a known provider", async () => {
    const response = await call("/auth-methods", {
      method: "POST",
      body: JSON.stringify({ type: "api_key", provider: "faux", key: "sk-x" }),
    });
    expect(response.status).toBe(201);
  });

  test("refuses a session naming a provider Pi does not know", async () => {
    const projectId = await readyProject();
    const response = await createSession(projectId, {
      name: "x",
      model: { provider: "anthopic", modelId: "claude" },
    });
    expect(response.status).toBe(400);
    expect((await jsonOf<{ error: { message: string } }>(response)).error.message).toBe(
      'unknown provider "anthopic"',
    );
  });

  test("refuses a session naming a model the provider does not offer", async () => {
    const projectId = await readyProject();
    const response = await createSession(projectId, {
      name: "x",
      model: { provider: "faux", modelId: "faux-9" },
    });
    expect(response.status).toBe(400);
    expect((await jsonOf<{ error: { message: string } }>(response)).error.message).toBe(
      'provider "faux" has no model "faux-9"',
    );
  });

  test("refuses a session whose configured default model is unknown", async () => {
    const projectId = await readyProject();
    config.defaultModel = { provider: "faux", modelId: "nope" };
    const response = await createSession(projectId, { name: "x" });
    expect(response.status).toBe(400);
    expect((await jsonOf<{ error: { message: string } }>(response)).error.message).toBe(
      'provider "faux" has no model "nope"',
    );
  });

  test("accepts a session naming a model the catalogue offers", async () => {
    const projectId = await readyProject();
    const response = await createSession(projectId, {
      name: "valid",
      model: { provider: "faux", modelId: "faux-1" },
    });
    expect(response.status).toBe(201);
    const body = await jsonOf<{ session: SessionId }>(response);
    created.push(body.session);
  }, 30_000);
});

describe("the project default model", () => {
  const setDefault = (projectId: string, model: unknown) =>
    call(`/projects/${projectId}/default-model`, {
      method: "PUT",
      body: JSON.stringify({ model }),
    });

  test("stores a default model on the project", async () => {
    const projectId = await registerProject();
    const response = await setDefault(projectId, { provider: "faux", modelId: "faux-1" });
    expect(response.status).toBe(200);
    const body = await jsonOf<{ project: { defaultModel: unknown } }>(response);
    expect(body.project.defaultModel).toEqual({ provider: "faux", modelId: "faux-1" });
  });

  test("clears the default model with null", async () => {
    const projectId = await registerProject();
    await setDefault(projectId, { provider: "faux", modelId: "faux-1" });
    const body = await jsonOf<{ project: { defaultModel: unknown } }>(
      await setDefault(projectId, null),
    );
    expect(body.project.defaultModel).toBeNull();
  });

  test("refuses a default model the catalogue does not offer", async () => {
    const projectId = await registerProject();
    const response = await setDefault(projectId, { provider: "faux", modelId: "faux-9" });
    expect(response.status).toBe(400);
    expect((await jsonOf<{ error: { message: string } }>(response)).error.message).toBe(
      'provider "faux" has no model "faux-9"',
    );
  });

  test("a new session uses the project's default model", async () => {
    const projectId = await readyProject();
    await setDefault(projectId, { provider: "faux", modelId: "faux-1" });
    const response = await createSession(projectId, { name: "defaulted" });
    expect(response.status).toBe(201);
    const body = await jsonOf<{ session: { id: SessionId; model: unknown } }>(response);
    expect(body.session.model).toEqual({ provider: "faux", modelId: "faux-1" });
    created.push(body.session.id);
  }, 30_000);
});
