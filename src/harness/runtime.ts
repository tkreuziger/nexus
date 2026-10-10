import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { CredentialStore, Models } from "@earendil-works/pi-ai";
import { type Conversation, createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { buildModels } from "../models.ts";
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

/** Open the session's Pi Durable conversation over its own SQLite store. */
export async function openSessionRuntime(input: SessionRuntimeInput): Promise<SessionRuntime> {
  const storage = await SqliteStorage.open(openBunSqliteDatabase(input.dbPath));
  const registry = createRegistry();
  registry.install(CodingTools);
  const models: Models = await buildModels(input.credentials);
  const harness = await Harness.open(
    storage,
    {
      models,
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
