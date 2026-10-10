import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  const method = await jsonOf<{ authMethod: { id: string } }>(
    await call("/auth-methods", {
      method: "POST",
      body: JSON.stringify({
        type: "api_key",
        provider: "faux",
        label: "faux key",
        key: "sk-fake-placeholder",
      }),
    }),
  );
  await call(`/projects/${body.project.id}/auth-method`, {
    method: "PUT",
    body: JSON.stringify({ authMethodId: method.authMethod.id }),
  });
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
    worktreesRoot: base,
    dataDir: base,
    piStorageDir: join(base, "sessions"),
    listen: { host: "127.0.0.1", port: 0 },
    secretKeyFile: join(base, "secret.key"),
    defaultModel: { provider: "faux", modelId: "faux-1" },
    bootstrapToken: null,
    webDir: null,
    compaction: { reserveTokens: 16_384, keepRecentTokens: 20_000 },
  };
  const secretKey = await loadOrCreateKey(config.secretKeyFile);
  supervisor = new SessionSupervisor(db, config, secretKey);
  app = createApp({ db, config, supervisor, secretKey });
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

  test("refuses to create a session without an assigned auth method", async () => {
    const path = await makeRepo("bare");
    const project = await jsonOf<{ project: { id: string } }>(
      await call("/projects", { method: "POST", body: JSON.stringify({ path }) }),
    );
    const response = await call(`/projects/${project.project.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({ name: "no-auth" }),
    });
    expect(response.status).toBe(400);
    const body = await jsonOf<{ error: { message: string } }>(response);
    expect(body.error.message).toContain("no assigned auth method");
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

  test("rejects an event stream for a session whose process died", async () => {
    const projectId = await registerProject();
    const id = await createSession(projectId);
    await waitForStatus(id, "idle");
    const running = await jsonOf<{ session: { pid: number } }>(await call(`/sessions/${id}`));
    process.kill(running.session.pid, "SIGKILL");
    await waitForStatus(id, "crashed");
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

describe("worktree isolation", () => {
  const sessionOf = async (id: SessionId) =>
    jsonOf<{ session: { worktreePath: string; branch: string } }>(await call(`/sessions/${id}`));

  test("gives each session its own worktree outside the project checkout", async () => {
    const projectId = await registerProject();
    const first = await createSession(projectId, "alpha");
    const second = await createSession(projectId, "beta");
    await waitForStatus(first, "idle");
    await waitForStatus(second, "idle");

    const one = await sessionOf(first);
    const two = await sessionOf(second);
    expect(one.session.worktreePath).not.toBe(two.session.worktreePath);
    expect(one.session.worktreePath).toContain(join(".pi-worktrees", "repo"));
    expect(one.session.branch).toBe("pi/alpha");
    expect(two.session.branch).toBe("pi/beta");

    const worktrees = await runGit(["worktree", "list", "--porcelain"], join(base, "repo"));
    expect(worktrees).toContain(one.session.worktreePath);
    expect(worktrees).toContain(two.session.worktreePath);
  }, 30_000);

  test("keeps edits in one session out of the others and the checkout", async () => {
    const projectId = await registerProject();
    const first = await createSession(projectId, "alpha");
    const second = await createSession(projectId, "beta");
    await waitForStatus(first, "idle");
    await waitForStatus(second, "idle");
    const one = await sessionOf(first);
    const two = await sessionOf(second);

    writeFileSync(join(one.session.worktreePath, "only-alpha.txt"), "x\n");
    expect(existsSync(join(two.session.worktreePath, "only-alpha.txt"))).toBe(false);
    expect(existsSync(join(base, "repo", "only-alpha.txt"))).toBe(false);
    expect((await runGit(["status", "--porcelain"], join(base, "repo"))).trim()).toBe("");
  }, 30_000);

  test("deletes the worktree and preserves the branch", async () => {
    const projectId = await registerProject();
    const id = await createSession(projectId, "alpha");
    await waitForStatus(id, "idle");
    const { session } = await sessionOf(id);

    const response = await call(`/sessions/${id}`, { method: "DELETE" });
    const body = await jsonOf<{ deleted: boolean; preservedBranch: string }>(response);
    expect(response.status).toBe(200);
    expect(body.preservedBranch).toBe("pi/alpha");
    expect(existsSync(session.worktreePath)).toBe(false);

    const branches = await runGit(["branch", "--list", "pi/alpha"], join(base, "repo"));
    expect(branches).toContain("pi/alpha");
    expect((await call(`/sessions/${id}`)).status).toBe(404);
  }, 30_000);

  test("refuses to delete uncommitted work, then deletes it when forced", async () => {
    const projectId = await registerProject();
    const id = await createSession(projectId, "alpha");
    await waitForStatus(id, "idle");
    const { session } = await sessionOf(id);
    writeFileSync(join(session.worktreePath, "uncommitted.txt"), "keep me\n");

    const refused = await call(`/sessions/${id}`, { method: "DELETE" });
    expect(refused.status).toBe(409);
    expect(existsSync(session.worktreePath)).toBe(true);

    const forced = await call(`/sessions/${id}?force=true`, { method: "DELETE" });
    expect(forced.status).toBe(200);
    expect(existsSync(session.worktreePath)).toBe(false);
  }, 30_000);

  test("keeps the worktree and the transcript across a crash and restart", async () => {
    const projectId = await registerProject();
    const id = await createSession(projectId, "alpha");
    await waitForStatus(id, "idle");
    const { session } = await sessionOf(id);

    const finished = readEvents(id, (events) => eventTypes(events).includes("run_end"));
    await call(`/sessions/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ requestId: "before-crash", text: "hello" }),
    });
    await finished;

    const pid = await jsonOf<{ session: { pid: number } }>(await call(`/sessions/${id}`));
    process.kill(pid.session.pid, "SIGKILL");
    await waitForStatus(id, "crashed");
    expect(existsSync(session.worktreePath)).toBe(true);

    await call(`/sessions/${id}/restart`, { method: "POST" });
    await waitForStatus(id, "idle");
    const after = await sessionOf(id);
    expect(after.session.worktreePath).toBe(session.worktreePath);

    const mirrored = await jsonOf<{ messages: { role: string }[] }>(
      await call(`/sessions/${id}/messages`),
    );
    expect(mirrored.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  }, 30_000);
});
