import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { CredentialStore, Models, MutableModels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { type Conversation, createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import type { ModelRef } from "../types.ts";
import { openBunSqliteDatabase } from "./bun-sqlite.ts";

/** An open Pi Durable conversation plus the storage it owns. */
export interface SessionRuntime {
  harness: Harness;
  root: Conversation;
  close(): Promise<void>;
}

export interface SessionRuntimeInput {
  dbPath: string;
  cwd: string;
  model: ModelRef;
  credentials: CredentialStore;
  compaction: { reserveTokens: number; keepRecentTokens: number };
}

/**
 * Optional extra providers for a harness process: `NEXUS_PROVIDERS_MODULE` names a module whose
 * default export registers providers on the collection. Used to run offline or in tests.
 */
async function applyProvidersModule(models: MutableModels): Promise<void> {
  const modulePath = process.env.NEXUS_PROVIDERS_MODULE;
  if (modulePath === undefined || modulePath === "") return;
  // The module path is runtime-selected (plugin loading), so a static import cannot express it.
  const loaded: unknown = await import(modulePath);
  const register =
    loaded !== null && typeof loaded === "object" && "default" in loaded
      ? (loaded as { default: unknown }).default
      : undefined;
  if (typeof register !== "function") {
    throw new Error(`NEXUS_PROVIDERS_MODULE must default-export a function: ${modulePath}`);
  }
  await (register as (models: MutableModels) => unknown)(models);
}

async function buildModels(credentials: CredentialStore): Promise<Models> {
  const models = builtinModels({ credentials });
  await applyProvidersModule(models);
  return models;
}

/** Open the session's Pi Durable conversation over its own SQLite store. */
export async function openSessionRuntime(input: SessionRuntimeInput): Promise<SessionRuntime> {
  const storage = await SqliteStorage.open(openBunSqliteDatabase(input.dbPath));
  const registry = createRegistry();
  registry.install(CodingTools);
  const harness = await Harness.open(
    storage,
    {
      models: await buildModels(input.credentials),
      registry,
      settings: {
        toolExecution: "parallel",
        compaction: {
          enabled: true,
          reserveTokens: input.compaction.reserveTokens,
          keepRecentTokens: input.compaction.keepRecentTokens,
        },
      },
      env: (target) => new NodeExecutionEnv({ cwd: target.cwd ?? input.cwd }),
    },
    BACKGROUND_CONTEXT,
  );
  const root = await harness.root(BACKGROUND_CONTEXT, {
    agent: { model: input.model, cwd: input.cwd },
  });
  return {
    harness,
    root,
    close: async () => {
      await harness.close(BACKGROUND_CONTEXT);
    },
  };
}
