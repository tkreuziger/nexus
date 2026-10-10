import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    }),
  );

/** Read a response body as the shape the test expects from our own API. */
const jsonOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const register = async (path: string, name?: string) => {
  const response = await call("/projects", {
    method: "POST",
    body: JSON.stringify(name === undefined ? { path } : { path, name }),
  });
  return { response, body: (await response.json()) as { project: { id: string; path: string } } };
};

beforeEach(async () => {
  db = openStore(":memory:");
  base = mkdtempSync(join(tmpdir(), "nexus-api-"));
  config = {
    projectsRoot: base,
    dataDir: base,
    piStorageDir: join(base, "sessions"),
    listen: { host: "127.0.0.1", port: 0 },
    secretKeyFile: join(base, "secret.key"),
    defaultModel: null,
    bootstrapToken: null,
  };
  const secretKey = await loadOrCreateKey(config.secretKeyFile);
  app = createApp({ db, config, supervisor: new SessionSupervisor(db, config, secretKey) });
  token = (await createUser(db, "owner", "secret-one")).token;
  otherToken = (await createUser(db, "intruder", "secret-two")).token;
});

describe("project routes", () => {
  test("registers a git folder and lists it", async () => {
    const path = await makeRepo("alpha");
    const { response } = await register(path);
    expect(response.status).toBe(201);
    const listed = await jsonOf<{ projects: { path: string }[] }>(await call("/projects"));
    expect(listed.projects).toHaveLength(1);
    expect(listed.projects[0]?.path).toBe(path);
  });

  test("returns project metadata by id", async () => {
    const path = await makeRepo("beta");
    const { body } = await register(path, "Beta");
    const response = await call(`/projects/${body.project.id}`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { project: { name: string } };
    expect(payload.project.name).toBe("Beta");
  });

  test("rejects a duplicate registration with 409", async () => {
    const path = await makeRepo("gamma");
    await register(path);
    const { response } = await register(path);
    expect(response.status).toBe(409);
  });

  test("rejects a non-git folder with 422", async () => {
    const path = join(base, "plain");
    mkdirSync(path, { recursive: true });
    const { response } = await register(path);
    expect(response.status).toBe(422);
  });

  test("rejects a missing path field with 400", async () => {
    const response = await call("/projects", { method: "POST", body: JSON.stringify({}) });
    expect(response.status).toBe(400);
  });

  test("rejects an unauthenticated request with 401", async () => {
    const response = await app(new Request("http://localhost/projects"));
    expect(response.status).toBe(401);
  });

  test("hides another user's project behind 404", async () => {
    const path = await makeRepo("delta");
    const { body } = await register(path);
    const response = await call(`/projects/${body.project.id}`, {}, otherToken);
    expect(response.status).toBe(404);
  });

  test("serves file content", async () => {
    const path = await makeRepo("epsilon");
    const { body } = await register(path);
    const response = await call(`/projects/${body.project.id}/content?path=README.md`);
    expect(response.status).toBe(200);
    const payload = await jsonOf<{
      content: { kind: string; path: string; size: number; text: string };
    }>(response);
    expect(payload.content).toEqual({ kind: "file", path: "README.md", size: 5, text: "# hi\n" });
  });

  test("refuses content traversal with 400", async () => {
    const path = await makeRepo("zeta");
    const { body } = await register(path);
    const response = await call(`/projects/${body.project.id}/content?path=../../etc/passwd`);
    expect(response.status).toBe(400);
  });

  test("reports git status including dirty files", async () => {
    const path = await makeRepo("eta");
    const { body } = await register(path);
    writeFileSync(join(path, "untracked.txt"), "new\n");
    const response = await call(`/projects/${body.project.id}/git/status`);
    const payload = (await response.json()) as { status: { branch: string; dirty: string[] } };
    expect(response.status).toBe(200);
    expect(payload.status.branch).toBe("main");
    expect(payload.status.dirty).toContain("untracked.txt");
  });

  test("reports the commit log", async () => {
    const path = await makeRepo("theta");
    const { body } = await register(path);
    const payload = (await (await call(`/projects/${body.project.id}/git/log`)).json()) as {
      commits: { subject: string }[];
    };
    expect(payload.commits.map((commit) => commit.subject)).toEqual(["init"]);
  });

  test("reports worktrees", async () => {
    const path = await makeRepo("iota");
    const { body } = await register(path);
    const payload = (await (await call(`/projects/${body.project.id}/git/worktrees`)).json()) as {
      worktrees: { path: string; branch: string | null }[];
    };
    expect(payload.worktrees).toHaveLength(1);
    expect(payload.worktrees[0]?.branch).toBe("main");
  });
});
