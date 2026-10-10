import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../../src/config.ts";
import { loadOrCreateKey } from "../../src/crypto/secrets.ts";
import { createApp } from "../../src/server/app.ts";
import { SessionSupervisor } from "../../src/sessions/supervisor.ts";
import { openStore } from "../../src/store/db.ts";
import { createUser } from "../../src/store/users.ts";

const INDEX = "<!doctype html><title>nexus</title>";
const ASSET = "console.log('app');";

let db: Database;
let app: (request: Request) => Promise<Response>;
let token: string;
let webDir: string;

const get = (path: string, bearer?: string) =>
  app(
    new Request(`http://localhost${path}`, {
      headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
    }),
  );

const buildConfig = (base: string, dir: string | null): Config => ({
  projectsRoot: base,
  worktreesRoot: base,
  dataDir: base,
  piStorageDir: join(base, "sessions"),
  listen: { host: "127.0.0.1", port: 0 },
  secretKeyFile: join(base, "secret.key"),
  defaultModel: null,
  bootstrapToken: null,
  webDir: dir,
  compaction: { reserveTokens: 16_384, keepRecentTokens: 20_000 },
});

const boot = async (base: string, dir: string | null): Promise<void> => {
  const config = buildConfig(base, dir);
  const secretKey = await loadOrCreateKey(config.secretKeyFile);
  app = createApp({
    db,
    config,
    supervisor: new SessionSupervisor(db, config, secretKey),
    secretKey,
  });
};

beforeEach(async () => {
  db = openStore(":memory:");
  const base = mkdtempSync(join(tmpdir(), "nexus-web-"));
  webDir = join(base, "dist");
  mkdirSync(join(webDir, "assets"), { recursive: true });
  writeFileSync(join(webDir, "index.html"), INDEX);
  writeFileSync(join(webDir, "assets", "app.js"), ASSET);
  await boot(base, webDir);
  token = (await createUser(db, "owner", "s3cret")).token;
});

describe("static web app", () => {
  test("serves index.html at the root", async () => {
    const response = await get("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe(INDEX);
  });

  test("falls back to index.html so client-side routes deep-link", async () => {
    const response = await get("/projects/abc/sessions/def");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX);
  });

  test("serves a real asset with its own content type", async () => {
    const response = await get("/assets/app.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(await response.text()).toBe(ASSET);
  });

  test("never shadows the API", async () => {
    const response = await get("/projects");
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await get("/projects", token)).status).toBe(200);
  });

  test("refuses a traversal outside the web root", async () => {
    // Encoded dots survive URL normalization, so the traversal reaches the handler.
    const response = await get("/%2e%2e%2f%2e%2e%2fetc%2fpasswd");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX);
  });

  test("only serves static files for GET", async () => {
    const response = await app(
      new Request("http://localhost/unknown", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  test("answers 404 as JSON when no web app is configured", async () => {
    await boot(mkdtempSync(join(tmpdir(), "nexus-noweb-")), null);
    const response = await get("/projects/abc/sessions/def");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
