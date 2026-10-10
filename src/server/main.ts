import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ModelCatalog } from "../catalog.ts";
import { loadConfig } from "../config.ts";
import { loadOrCreateKey } from "../crypto/secrets.ts";
import { SessionSupervisor } from "../sessions/supervisor.ts";
import { openStore } from "../store/db.ts";
import { createUser } from "../store/users.ts";
import { createApp } from "./app.ts";

/** Create the first user when the store is empty, returning the bearer token to print once. */
async function ensureBootstrapUser(
  db: ReturnType<typeof openStore>,
  token: string | null,
): Promise<string | null> {
  const existing = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM users").get();
  if ((existing?.count ?? 0) > 0) return null;
  const secret = token ?? crypto.randomUUID().replaceAll("-", "");
  const { token: bearer } = await createUser(db, "owner", secret);
  return bearer;
}

async function main(): Promise<void> {
  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.piStorageDir, { recursive: true });

  const db = openStore(join(config.dataDir, "server.sqlite"));
  const secretKey = await loadOrCreateKey(config.secretKeyFile);
  const supervisor = new SessionSupervisor(db, config, secretKey);
  supervisor.reconcile();

  // Built at boot so a broken NEXUS_PROVIDERS_MODULE stops the server rather than the first session.
  const catalog = new ModelCatalog();
  await catalog.load();
  if (
    config.defaultModel !== null &&
    (await catalog.model(config.defaultModel.provider, config.defaultModel.modelId)) === undefined
  ) {
    console.warn(
      `nexus: NEXUS_DEFAULT_MODEL "${config.defaultModel.provider}:${config.defaultModel.modelId}" is not a model this Pi knows`,
    );
  }

  const bootstrapToken = await ensureBootstrapUser(db, config.bootstrapToken);
  if (bootstrapToken !== null) {
    console.log(`nexus: created user "owner". bearer token (shown once):\n  ${bootstrapToken}`);
  }

  const server = Bun.serve({
    hostname: config.listen.host,
    port: config.listen.port,
    // Bun closes a connection idle for longer than this. An event stream is idle between turns, so
    // the timeout is raised well above the stream's heartbeat interval.
    idleTimeout: 120,
    fetch: createApp({ db, config, supervisor, secretKey, catalog }),
  });
  console.log(`nexus: listening on http://${server.hostname}:${server.port}`);
  console.log(`nexus: projects root ${config.projectsRoot}`);
}

await main();
