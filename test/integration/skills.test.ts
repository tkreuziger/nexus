import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_PREFIX } from "@nexus/client";
import { ModelCatalog } from "../../src/catalog.ts";
import type { Config } from "../../src/config.ts";
import { loadOrCreateKey } from "../../src/crypto/secrets.ts";
import { runGit } from "../../src/projects/git.ts";
import { asArray, asRecord } from "../../src/records.ts";
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
let agentDir: string;
let created: SessionId[];

const writeSkill = (dir: string, name: string, description: string): string => {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  writeFileSync(
    file,
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody.\n`,
  );
  return file;
};

/** A git repository that also carries a project skill at the Pi location, `.pi/skills`. */
const makeRepo = async (name: string): Promise<string> => {
  const path = join(base, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "README.md"), "# hi\n");
  writeSkill(join(path, ".pi", "skills", "repo-skill"), "repo-skill", "Lives in the repository.");
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

async function createSession(projectId: string): Promise<SessionId> {
  const response = await call(`/projects/${projectId}/sessions`, {
    method: "POST",
    body: JSON.stringify({ name: "skills" }),
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

/**
 * The `skills` prompt section of every `pi.system` entry in a frame's committed state, from the
 * snapshot a fresh attachment receives. The mirror skips `pi.system`, so the stream is where the
 * prompt is observable.
 */
function skillsSections(events: readonly unknown[]): string[] {
  const sections: string[] = [];
  for (const event of events) {
    for (const entry of asArray(asRecord(event)?.entries)) {
      const record = asRecord(entry);
      if (record?.kind !== "pi.system") continue;
      const message = asRecord(asArray(record.model)[0]);
      const text = asRecord(message?.sections)?.skills;
      if (typeof text === "string") sections.push(text);
    }
  }
  return sections;
}

/** Run one prompt, then read the snapshot a fresh attachment receives. */
async function promptAndSnapshot(
  id: SessionId,
  requestId: string,
  assistantCount: number,
): Promise<unknown[]> {
  await call(`/sessions/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ requestId, text: "say hello" }),
  });
  await waitFor(async () => {
    const body = await jsonOf<{ messages: { role: string }[] }>(
      await call(`/sessions/${id}/messages`),
    );
    const answers = body.messages.filter((message) => message.role === "assistant").length;
    return answers >= assistantCount ? body.messages : undefined;
  }, "mirrored assistant message");

  // The timeout only caps a hung stream; everything below is condition-driven.
  const response = await app(
    new Request(`http://localhost${API_PREFIX}/sessions/${id}/events`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    }),
  );
  if (response.body === null) throw new Error("event stream has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: unknown[] = [];
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) break;
      const data = buffer
        .slice(0, boundary)
        .split("\n")
        .find((line) => line.startsWith("data: "));
      buffer = buffer.slice(boundary + 2);
      if (data === undefined) continue;
      const event: unknown = JSON.parse(data.slice(6));
      events.push(event);
      if (asRecord(event)?.type === "snapshot") {
        await reader.cancel();
        return events;
      }
    }
  }
  throw new Error("event stream ended before a snapshot arrived");
}

beforeEach(async () => {
  db = openStore(":memory:");
  base = mkdtempSync(join(tmpdir(), "nexus-skills-"));
  agentDir = join(base, "agent");
  writeSkill(join(agentDir, "skills", "user-skill"), "user-skill", "Lives in the agent directory.");
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
    compaction: { reserveTokens: 16_384, keepRecentTokens: 20_000 },
  };
  const secretKey = await loadOrCreateKey(config.secretKeyFile);
  supervisor = new SessionSupervisor(db, config, secretKey);
  app = createApp({ db, config, supervisor, secretKey, catalog: new ModelCatalog() });
  token = (await createUser(db, "owner", "secret-one")).token;
  created = [];
  process.env.NEXUS_PROVIDERS_MODULE = FAUX_MODULE;
  process.env.NEXUS_FAUX_REPLY = "hello from faux";
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(async () => {
  for (const id of created) await supervisor.stop(id).catch(() => undefined);
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(base, { recursive: true, force: true });
});

describe("skills in a session", () => {
  test("advertises the agent directory's and the repository's skills to the agent", async () => {
    const id = await createSession(await registerProject());
    await waitFor(
      async () => ((await sessionStatus(id)) === "idle" ? true : undefined),
      "session idle",
    );
    const session = await jsonOf<{ session: { worktreePath: string } }>(
      await call(`/sessions/${id}`),
    );

    const sections = skillsSections(await promptAndSnapshot(id, "req-1", 1));

    expect(sections).toHaveLength(1);
    const section = sections[0] ?? "";
    expect(section).toContain("<name>user-skill</name>");
    expect(section).toContain(join(agentDir, "skills", "user-skill", "SKILL.md"));
    expect(section).toContain("<name>repo-skill</name>");
    // Project skills are read from the session's worktree, not the registered checkout.
    expect(section).toContain(
      join(session.session.worktreePath, ".pi", "skills", "repo-skill", "SKILL.md"),
    );
  }, 30_000);

  test("carries no skills section when nothing is discoverable", async () => {
    process.env.PI_CODING_AGENT_DIR = join(base, "empty-agent");
    const id = await createSession(await registerProject());
    await waitFor(
      async () => ((await sessionStatus(id)) === "idle" ? true : undefined),
      "session idle",
    );

    // The worktree still holds the repository's `.pi/skills`, so only the global root is empty.
    const sections = skillsSections(await promptAndSnapshot(id, "req-1", 1));
    const section = sections[0] ?? "";

    expect(section).not.toContain("<name>user-skill</name>");
    expect(section).toContain("<name>repo-skill</name>");
  }, 30_000);

  test("advertises a skill added after the session started", async () => {
    const id = await createSession(await registerProject());
    await waitFor(
      async () => ((await sessionStatus(id)) === "idle" ? true : undefined),
      "session idle",
    );
    await promptAndSnapshot(id, "req-1", 1);

    writeSkill(join(agentDir, "skills", "second-skill"), "second-skill", "Added mid-session.");

    const sections = skillsSections(await promptAndSnapshot(id, "req-2", 2));

    // The section renders per request, so the second turn carries the new skill.
    expect(sections.at(-1)).toContain("<name>second-skill</name>");
  }, 30_000);
});
