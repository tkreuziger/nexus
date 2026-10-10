import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../../src/config.ts";
import { loadOrCreateKey } from "../../src/crypto/secrets.ts";
import { runGit } from "../../src/projects/git.ts";
import { asRecord } from "../../src/records.ts";
import { createApp } from "../../src/server/app.ts";
import { SessionSupervisor } from "../../src/sessions/supervisor.ts";
import { openStore } from "../../src/store/db.ts";
import { createUser } from "../../src/store/users.ts";
import type { SessionId } from "../../src/types.ts";

const FAUX_MODULE = join(import.meta.dir, "..", "fixtures", "faux-provider.ts");

let db: Database;
let config: Config;
let supervisor: SessionSupervisor;
let app: (request: Request) => Promise<Response>;
let token: string;
let base: string;
let created: SessionId[];

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

const call = (path: string, init: RequestInit = {}) =>
  app(
    new Request(`http://localhost${path}`, {
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

/** Poll until `probe` yields a value. Condition-driven, so no fixed delay is guessed. */
async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  label: string,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await yieldToLoop();
  }
}

async function registerProject(): Promise<string> {
  const path = await makeRepo("repo");
  const response = await call("/projects", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
  const body = await jsonOf<{ project: { id: string } }>(response);
  return body.project.id;
}

async function createSession(projectId: string, name = "first"): Promise<SessionId> {
  const response = await call(`/projects/${projectId}/sessions`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (response.status !== 201) throw new Error(`create failed: ${await response.text()}`);
  const body = await jsonOf<{ session: { id: SessionId } }>(response);
  created.push(body.session.id);
  return body.session.id;
}

const sessionStatus = async (id: SessionId): Promise<string | undefined> => {
  const body = await jsonOf<{ session: { status: string } }>(await call(`/sessions/${id}`));
  return body.session.status;
};

const waitForStatus = (id: SessionId, status: string) =>
  waitFor(
    async () => ((await sessionStatus(id)) === status ? status : undefined),
    `status ${status}`,
  );

/** Read SSE frames until `stop` is satisfied, aborting the request when done. */
async function readEvents(
  id: SessionId,
  stop: (events: unknown[]) => boolean,
  onAttached?: () => void,
): Promise<unknown[]> {
  const controller = new AbortController();
  const safety = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await app(
      new Request(`http://localhost/sessions/${id}/events`, {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      }),
    );
    if (response.body === null) throw new Error("event stream has no body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events: unknown[] = [];
    let buffer = "";
    while (!stop(events)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) break;
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split("\n").find((line) => line.startsWith("data: "));
        if (data !== undefined) {
          const event: unknown = JSON.parse(data.slice(6));
          events.push(event);
          // The snapshot proves this client's attachment exists, so a later submit cannot race it.
          if (eventTypes([event]).includes("snapshot")) onAttached?.();
        }
      }
    }
    await reader.cancel();
    return events;
  } finally {
    clearTimeout(safety);
    controller.abort();
  }
}

const eventTypes = (events: unknown[]): string[] =>
  events.map((event) => {
    const record = asRecord(event);
    return record === undefined ? "unknown" : String(record.type);
  });

beforeEach(async () => {
  db = openStore(":memory:");
  base = mkdtempSync(join(tmpdir(), "nexus-sessions-"));
  config = {
    projectsRoot: base,
    dataDir: base,
    piStorageDir: join(base, "sessions"),
    listen: { host: "127.0.0.1", port: 0 },
    secretKeyFile: join(base, "secret.key"),
    defaultModel: { provider: "faux", modelId: "faux-1" },
    bootstrapToken: null,
  };
  const secretKey = await loadOrCreateKey(config.secretKeyFile);
  supervisor = new SessionSupervisor(db, config, secretKey);
  app = createApp({ db, config, supervisor });
  token = (await createUser(db, "owner", "secret-one")).token;
  created = [];
  process.env.NEXUS_PROVIDERS_MODULE = FAUX_MODULE;
  process.env.NEXUS_FAUX_REPLY = "hello from faux";
});

afterEach(async () => {
  for (const id of created) await supervisor.stop(id).catch(() => undefined);
});

describe("session lifecycle", () => {
  test("creates a session and reaches idle", async () => {
    const projectId = await registerProject();
    const id = await createSession(projectId);
    expect(await waitForStatus(id, "idle")).toBe("idle");
    const body = await jsonOf<{ session: { name: string; conversationId: string | null } }>(
      await call(`/sessions/${id}`),
    );
    expect(body.session.name).toBe("first");
    expect(body.session.conversationId).not.toBeNull();
  }, 30_000);

  test("lists sessions under their project", async () => {
    const projectId = await registerProject();
    await createSession(projectId, "alpha");
    await waitForStatus(created[0] as SessionId, "idle");
    const body = await jsonOf<{ sessions: { name: string }[] }>(
      await call(`/projects/${projectId}/sessions`),
    );
    expect(body.sessions.map((session) => session.name)).toEqual(["alpha"]);
  }, 30_000);

  test("rejects a duplicate session name", async () => {
    const projectId = await registerProject();
    await createSession(projectId, "dupe");
    await waitForStatus(created[0] as SessionId, "idle");
    const response = await call(`/projects/${projectId}/sessions`, {
      method: "POST",
      body: JSON.stringify({ name: "dupe" }),
    });
    expect(response.status).toBe(409);
  }, 30_000);
});

describe("conversation interaction", () => {
  test("streams events for a prompt and mirrors the transcript", async () => {
    const projectId = await registerProject();
    const id = await createSession(projectId);
    await waitForStatus(id, "idle");

    const attached = Promise.withResolvers<void>();
    const eventsPromise = readEvents(
      id,
      (events) => eventTypes(events).includes("run_end"),
      () => attached.resolve(),
    );
    await attached.promise;
    await call(`/sessions/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ requestId: "req-1", text: "say hello" }),
    });
    const events = await eventsPromise;
    const types = eventTypes(events);
    expect(types).toContain("snapshot");
    expect(types).toContain("message_start");
    expect(types).toContain("run_start");
    expect(types).toContain("run_end");

    const mirrored = await waitFor(async () => {
      const body = await jsonOf<{ messages: { role: string; content: string }[] }>(
        await call(`/sessions/${id}/messages`),
      );
      return body.messages.some((message) => message.role === "assistant")
        ? body.messages
        : undefined;
    }, "mirrored assistant message");
    expect(mirrored.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(mirrored[1]?.content).toContain("hello from faux");
  }, 30_000);

  test("deduplicates a repeated request id", async () => {
    const projectId = await registerProject();
    const id = await createSession(projectId);
    await waitForStatus(id, "idle");
    const first = await jsonOf<{ submissionId: string }>(
      await call(`/sessions/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ requestId: "same", text: "once" }),
      }),
    );
    const second = await jsonOf<{ submissionId: string }>(
      await call(`/sessions/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ requestId: "same", text: "once" }),
      }),
    );
    expect(second.submissionId).toBe(first.submissionId);
    const body = await jsonOf<{ messages: { role: string }[] }>(
      await call(`/sessions/${id}/messages`),
    );
    expect(body.messages.filter((message) => message.role === "user")).toHaveLength(1);
  }, 30_000);

  test("a late joiner receives a snapshot, not a replay", async () => {
    const projectId = await registerProject();
    const id = await createSession(projectId);
    await waitForStatus(id, "idle");
    const attached = Promise.withResolvers<void>();
    const finished = readEvents(
      id,
      (events) => eventTypes(events).includes("run_end"),
      () => attached.resolve(),
    );
    await attached.promise;
    await call(`/sessions/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ requestId: "req-late", text: "hello" }),
    });
    await finished;

    const late = await readEvents(id, (events) =>
      events.some(
        (event) =>
          event !== null &&
          typeof event === "object" &&
          "type" in event &&
          event.type === "snapshot",
      ),
    );
    const snapshot = asRecord(late[1]);
    expect(eventTypes(late).slice(0, 2)).toEqual(["session_status", "snapshot"]);
    const entries = snapshot === undefined ? [] : (asRecord(snapshot)?.entries ?? []);
    expect(Array.isArray(entries) ? entries.length : 0).toBeGreaterThanOrEqual(3);
  }, 30_000);

  test("rejects an event stream for a stopped session", async () => {
    const projectId = await registerProject();
    const id = await createSession(projectId);
    await waitForStatus(id, "idle");
    await call(`/sessions/${id}`, { method: "DELETE" });
    const response = await call(`/sessions/${id}/events`);
    expect(response.status).toBe(409);
  }, 30_000);

  test("reports a crashed session and resumes it after a restart", async () => {
    const projectId = await registerProject();
    const id = await createSession(projectId);
    await waitForStatus(id, "idle");
    const before = await jsonOf<{ session: { conversationId: string; pid: number | null } }>(
      await call(`/sessions/${id}`),
    );
    expect(before.session.pid).not.toBeNull();
    // Simulate an unexpected process death, exactly as an operator would.
    process.kill(before.session.pid as number, "SIGKILL");

    await waitForStatus(id, "crashed");
    await call(`/sessions/${id}/restart`, { method: "POST" });
    expect(await waitForStatus(id, "idle")).toBe("idle");
    const after = await jsonOf<{ session: { conversationId: string } }>(
      await call(`/sessions/${id}`),
    );
    expect(after.session.conversationId).toBe(before.session.conversationId);
  }, 30_000);
});
