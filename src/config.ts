import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ModelRef } from "./types.ts";

/** Server configuration, read once at boot from the environment (§6.3). */
export interface Config {
  projectsRoot: string;
  /** Where session worktrees live; defaults to the projects root (`INPUT.md` §5.3). */
  worktreesRoot: string;
  dataDir: string;
  piStorageDir: string;
  listen: { host: string; port: number };
  secretKeyFile: string;
  defaultModel: ModelRef | null;
  bootstrapToken: string | null;
}

function parseListen(value: string | undefined): Config["listen"] {
  if (value === undefined) return { host: "127.0.0.1", port: 8787 };
  const separator = value.lastIndexOf(":");
  if (separator <= 0) throw new Error(`NEXUS_LISTEN must be host:port, got "${value}"`);
  const port = Number(value.slice(separator + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`NEXUS_LISTEN has an invalid port: "${value}"`);
  }
  return { host: value.slice(0, separator), port };
}

function parseModel(value: string | undefined): ModelRef | null {
  if (value === undefined || value === "") return null;
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`NEXUS_DEFAULT_MODEL must be provider:modelId, got "${value}"`);
  }
  return { provider: value.slice(0, separator), modelId: value.slice(separator + 1) };
}

/** Read configuration from `env`, applying defaults and validating the values that are present. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const dataDir = resolve(env.NEXUS_DATA_DIR ?? join(homedir(), ".nexus"));
  const projectsRoot = resolve(env.NEXUS_PROJECTS_ROOT ?? join(homedir(), "nexus-projects"));
  return {
    projectsRoot,
    worktreesRoot: resolve(env.NEXUS_WORKTREES_ROOT ?? projectsRoot),
    dataDir,
    piStorageDir: resolve(env.NEXUS_PI_STORAGE_DIR ?? join(dataDir, "sessions")),
    listen: parseListen(env.NEXUS_LISTEN),
    secretKeyFile: resolve(env.NEXUS_SECRET_KEY_FILE ?? join(dataDir, "secret.key")),
    defaultModel: parseModel(env.NEXUS_DEFAULT_MODEL),
    bootstrapToken: env.NEXUS_BOOTSTRAP_TOKEN ?? null,
  };
}
