# Pi Durable API — Verified Surface

The Pi Durable calls this project depends on, as verified by execution against `@earendil-works/pi-durable@1.1.0` on Bun 1.3.14.

## Context

Pi Durable is experimental and its API changes between releases. `INPUT.md` §5.1 requires an exact pin, so the calls below are the contract this project codes against. Everything here was run, not read from prose. Re-verify with the probe scripts described in "Reproduction" before any version bump.

## Package Facts

- Version: `1.1.0`, published 2026-10-07. `engines.node >= 22.19.0`.
- `"bin": null` — **no CLI or harness binary ships**. A harness process is application code.
- Entry points: `.`, `./tools`, `./env`, `./env/node`, `./storage/memory`, `./storage/jsonl`, `./storage/jsonl/node`, `./storage/sqlite`, `./storage/sqlite/node`, `./storage/sqlite/cloudflare`, `./testing`.
- Peer deps used directly: `@earendil-works/pi-ai` (providers, models, auth), `@earendil-works/chord` (`BACKGROUND_CONTEXT`).

## Opening a Harness

```ts
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const storage = await SqliteStorage.open(db);          // db: SqliteDatabase facade
const models = builtinModels({ credentials: store });   // store: CredentialStore
const registry = createRegistry();
registry.install(CodingTools);
const harness = await Harness.open(storage, {
  models, registry,
  env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? worktreePath }),
  settings: { toolExecution: "parallel", compaction: { enabled: true } },
}, BACKGROUND_CONTEXT);
const root = await harness.root(ctx, { agent: { model: { provider, modelId }, cwd: worktreePath } });
```

- `SqliteStorage`'s constructor is private; **`SqliteStorage.open(db)` is the only factory and it applies migrations**. Constructing it directly leaves the schema absent (`SQLiteError: no such table: tasks`).
- `db` is a `SqliteDatabase` (`exec`/`run`/`get`/`all`/`transaction`/`close`, all async). `transaction` must serialize against unrelated operations and roll back on rejection.

## Storage on Bun

`@earendil-works/pi-durable/storage/sqlite/node` (`openNodeSqliteStorage`) uses `node:sqlite`, which **Bun 1.3.14 does not implement** (`error: No such built-in module: node:sqlite`). Use the portable core plus a `bun:sqlite` facade. The facade lives at `src/harness/bun-sqlite.ts`.

## Submitting and Deduplication

```ts
const sub = await root.submit({ type: "input", content: "hi", requestId: "req-1" }, ctx);
const settled = await sub.wait(ctx);            // status "done" | "unanswered"
const again = await root.submit({ type: "input", content: "hi", requestId: "req-1" }, ctx);
// again.id === sub.id
```

`requestId` is a host-supplied dedup key scoped to the conversation. `harness.submission(id, ctx)` reacquires a submission after a restart.

## Watching

```ts
const stream = await watchEvents(harness, root.id, ctx);
stream.snapshot;                                // SnapshotEvent
stream.start(async (batch) => { /* AgentEvent[] */ });
await stream.stop();
```

`snapshot` carries `entries`, `tools`, `compactions`, `inbox`, `agent`, `usage`. Batches are one per commit and include `entry_appended`, `message_start`/`message_update`/`message_end`, `tool_execution_start`/`_update`/`_end`, `run_start`/`run_end`, `submission`, `usage_changed`, `task_failed`, `compaction_start`/`_end`, and `snapshot` (on overflow). A consumer more than 100 batches behind receives a fresh `snapshot` instead of a replay.

## Entry Kinds

Observed transcript kinds: `pi.user`, `pi.system`, `pi.assistant`, `pi.tool-result`, `pi.reset`, `pi.compaction`.

`EntryRecord` = `{ id, conversationId, kind, model?, data?, head?, edits?, byTaskId? }`. `model` holds pi-ai `Message[]`; an assistant entry's `model[0].content` carries `text` / `thinking` / `toolCall` blocks. `ToolResultEntry.data` holds `diagnostics`.

## Recovery

```ts
harness.resume();   // starts the scheduler; submitting or waiting starts it too
```

Verified: a run interrupted by `process.exit(9)` left its input committed; after reopening the same DB, `harness.resume()` plus reacquiring the submission by `requestId` settled `done` and appended the answer. All prior entries survived. Durability comes from SQLite WAL (`synchronous=NORMAL`).

## Credentials

```ts
import { createModels } from "@earendil-works/pi-ai/models";        // or builtinModels
const models = createModels({ credentials: myCredentialStore });
```

`CredentialStore` = `read` / `list` / `modify` / `delete`, keyed by provider id, one credential per provider. `modify` is the only write path and is where `Models.getAuth()` performs OAuth refresh, so a proxy store that persists through `modify` survives token rotation. `Credential` = `ApiKeyCredential | OAuthCredential`.

## Test Fixtures

`fauxProvider({ provider, models: [{ id }] })` from `@earendil-works/pi-ai/providers/faux` runs a scripted model with no network or key. Script with `setResponses([...])` using `fauxAssistantMessage`, `fauxToolCall`, `fauxText`, `fauxThinking`.

**Gotcha:** `fauxAssistantMessage` defaults `stopReason: "stop"`, which generation treats as the final answer. Tool calls are only executed when the message carries `stopReason: "toolUse"`.

## Skills

Pi Durable has no skills module, so discovery and prompt formatting come from the CLI package, pinned at the same `1.1.0` (ADR-10). Both are root exports:

```ts
import { formatSkillsForPrompt, loadSkills } from "@earendil-works/pi-coding-agent";

const { skills, diagnostics } = loadSkills({
  cwd: worktreePath,
  agentDir: "/root/.pi/agent",
  skillPaths: ["/root/.agents/skills"],
  includeDefaults: true,
});
const block = formatSkillsForPrompt(skills);   // prelude + <available_skills>, "" without skills
```

- `includeDefaults` adds `<agentDir>/skills` and `<cwd>/.pi/skills`; `skillPaths` adds any further root. A path that does not exist produces a warning, so only existing directories are passed.
- `loadSkills` is synchronous (`node:fs`) and validating: a skill without a `description` is dropped with a diagnostic, an invalid `name` warns but still loads, a duplicate name keeps the first and warns, and symlinked duplicates are dropped by canonical path.
- The block is installed as an untagged prompt section, rendered before every request, so the text the model sees is Pi's own.
- Verified by execution: `test/unit/skills.test.ts` and `test/integration/skills.test.ts`, plus a probe in which the agent's `read` call returned a `SKILL.md` body from outside the worktree.

## Reproduction

Probes used to establish the above (throwaway, under `/tmp/pidurable-probe`):
- `smoke.ts` — open, submit, dedup, watch, reopen.
- `tool.ts` — tool round, then abrupt exit and `resume()` recovery.
- `bun-sqlite.ts` — the `SqliteDatabase` facade.
- `diag.ts` — entry enumeration and storage reads.
- `creds.ts` — `builtinModels` with a proxy `CredentialStore` resolving provider auth.

## Related

- `docs/plans/pi-session-server.md` — how this project uses the surface
- `docs/architecture/adrs/` — ADR-2 (credentials), ADR-4 (storage)
