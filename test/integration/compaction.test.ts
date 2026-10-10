import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
/** Small enough that the default compaction reserve forces a compaction on the first request. */
const TINY_CONTEXT_WINDOW = "2000";

let db: Database;
let config: Config;
let supervisor: SessionSupervisor;
let app: (request: Request) => Promise<Response>;
let token: string;
let base: string;
let sessionId: SessionId;

const call = (path: string, init: RequestInit = {}) =>
  app(
    new Request(`http://localhost${API_PREFIX}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    }),
  );

const jsonOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const yieldToLoop = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
};

async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  label: string,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await yieldToLoop();
  }
}

interface MirrorRow {
  sequence: number;
  role: string;
  content: string;
}

const mirror = async (): Promise<MirrorRow[]> =>
  (await jsonOf<{ messages: MirrorRow[] }>(await call(`/sessions/${sessionId}/messages`))).messages;

beforeEach(async () => {
  db = openStore(":memory:");
  base = mkdtempSync(join(tmpdir(), "nexus-compact-"));
  config = {
    projectsRoot: base,
    worktreesRoot: base,
    dataDir: base,
    piStorageDir: join(base, "sessions"),
    listen: { host: "127.0.0.1", port: 0 },
    secretKeyFile: join(base, "secret.key"),
    defaultModel: { provider: "faux", modelId: "faux-1" },
    bootstrapToken: null,
    webDir: null,
    sseHeartbeatMs: 50,
    compaction: { reserveTokens: 100, keepRecentTokens: 200 },
  };
  const secretKey = await loadOrCreateKey(config.secretKeyFile);
  supervisor = new SessionSupervisor(db, config, secretKey);
  app = createApp({ db, config, supervisor, secretKey, catalog: new ModelCatalog() });
  token = (await createUser(db, "owner", "secret-one")).token;
  process.env.NEXUS_PROVIDERS_MODULE = FAUX_MODULE;
  process.env.NEXUS_FAUX_REPLY = "noted";
  process.env.NEXUS_FAUX_CONTEXT_WINDOW = TINY_CONTEXT_WINDOW;

  const projectPath = join(base, "repo");
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(join(projectPath, "README.md"), "# hi\n");
  await runGit(["init", "-b", "main"], projectPath);
  await runGit(["add", "."], projectPath);
  await runGit(
    ["-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-m", "init"],
    projectPath,
  );
  const project = await jsonOf<{ project: { id: string } }>(
    await call("/projects", { method: "POST", body: JSON.stringify({ path: projectPath }) }),
  );
  const method = await jsonOf<{ authMethod: { id: string } }>(
    await call("/auth-methods", {
      method: "POST",
      body: JSON.stringify({
        type: "api_key",
        provider: "faux",
        key: "sk-fake-placeholder",
      }),
    }),
  );
  await call(`/projects/${project.project.id}/auth-method`, {
    method: "PUT",
    body: JSON.stringify({ authMethodId: method.authMethod.id }),
  });
  const session = await jsonOf<{ session: { id: SessionId } }>(
    await call(`/projects/${project.project.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({ name: "long" }),
    }),
  );
  sessionId = session.session.id;
  await waitFor(async () => {
    const body = await jsonOf<{ session: { status: string } }>(
      await call(`/sessions/${sessionId}`),
    );
    return body.session.status === "idle" ? true : undefined;
  }, "session idle");
});

afterEach(async () => {
  delete process.env.NEXUS_FAUX_CONTEXT_WINDOW;
  await supervisor.remove(sessionId, { force: true }).catch(() => undefined);
});

describe("history survives compaction", () => {
  test("keeps every original message in the mirror after Pi Durable compacts", async () => {
    const filler = "lorem ipsum dolor sit amet ".repeat(40);
    const prompts = ["first question", "second question", "third question"].map(
      (text) => `${text} ${filler}`,
    );
    for (const [index, text] of prompts.entries()) {
      await call(`/sessions/${sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({ requestId: `req-${index}`, text }),
      });
      await waitFor(async () => {
        const rows = await mirror();
        return rows.filter((row) => row.role === "assistant").length > index ? true : undefined;
      }, `answer ${index}`);
    }

    // A compaction entry is mirrored as a `meta` row once Pi summarises older context.
    const compacted = await waitFor(async () => {
      const rows = await mirror();
      return rows.some((row) => row.role === "meta") ? rows : undefined;
    }, "compaction entry");
    expect(compacted.some((row) => row.role === "meta")).toBe(true);

    // Every user message is still present, even though Pi's own context no longer shows them all.
    const users = compacted.filter((row) => row.role === "user").map((row) => row.content);
    expect(users).toHaveLength(prompts.length);
    for (const text of prompts) {
      expect(users.some((content) => content.includes(text))).toBe(true);
    }
    expect(compacted.filter((row) => row.role === "assistant")).toHaveLength(prompts.length);
  }, 60_000);
});
