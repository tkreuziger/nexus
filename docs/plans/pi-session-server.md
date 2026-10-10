# Pi Session Server — Implementation Plan

Implementation plan for the durable agent session control plane specified in `INPUT.md`: projects, auth methods, worktree-isolated Pi Durable sessions, and an attachable event surface.

## Status

- **M1 complete** — project registry, read-only content API, read-only git state, bearer auth.
- **M2 complete** — harness process, stdio IPC, session lifecycle, SSE event stream, message mirror, crash/restart, boot-time reconciliation. 77 tests pass; type checker and linter clean; verified against a running server.
- M3 next — worktree per session, deletion semantics.
- ADR-1 … ADR-7 written at `docs/architecture/adrs/`.

## Context

Greenfield repository (`/home/tristan/code/projects/nexus`), single commit-less `main`, only `INPUT.md` present. Deliverable is a TypeScript-on-Bun HTTP control plane that supervises per-session Pi Durable harness processes. Related: `INPUT.md` (requirements), `docs/architecture/pi-durable-api.md` (verified API surface), `docs/architecture/adrs/` (decision records).

## Verified Facts

Everything below was executed on this workstation, not inferred. Probe scripts lived in `/tmp/pidurable-probe`.

| Fact | Evidence |
|---|---|
| Pi Durable latest = `1.1.0` (published 2026-10-07) | `npm view @earendil-works/pi-durable version` |
| **Pi Durable ships no CLI/binary** (`"bin": null`) | package.json; exports are library entry points only |
| **Bun 1.3.14 has no `node:sqlite`** | `bun run` → `error: No such built-in module: node:sqlite` |
| Portable `SqliteStorage` + `bun:sqlite` facade works | `SqliteStorage.open(db)` → `Harness.open` → submit → reopen → entries intact |
| Full turn works on Bun | entries `pi.user, pi.system, pi.assistant, pi.tool-result, pi.assistant` with `CodingTools` + `NodeExecutionEnv` |
| `requestId` dedup is built in | same `requestId` twice → `again.id === sub.id` |
| `watchEvents` gives snapshot + per-commit batches | `snapshot` keys `type,entries,tools,compactions,inbox,agent,usage`; then `message_start…run_end` |
| **Crash recovery works** | abrupt `process.exit(9)` mid-run → reopen + `harness.resume()` + reacquire submission by `requestId` → `settled: done`, history intact |
| `fauxProvider` enables keyless tests | `@earendil-works/pi-ai/providers/faux`, scripted via `setResponses([...])` |
| Credential injection point | `createModels({ credentials })` / `builtinModels({ credentials })`, `CredentialStore` interface |
| Proxy `CredentialStore` resolves auth | `builtinModels({credentials: store})` → 42 providers → `getAuth("openai")` returned the injected key via `store.read` |
| OAuth refresh is internal to `Models.getAuth()` | refresh runs inside `CredentialStore.modify` |
| `crypto.subtle`, `Bun.serve`, `Bun.password` available | `bun -e` probe |

### Consequence: the "harness process" is ours to write

`INPUT.md` §5.2 assumes a Pi Durable harness process exists to spawn. It does not. We must write `src/harness/main.ts`: a small program that opens a `Harness` over that session's SQLite, installs `CodingTools`, and speaks our IPC protocol on stdio. This is the single largest piece of work the spec does not name.

### Consequence: storage ownership is exclusive

Pi Durable storage: "One process owns a storage at a time; there is no cross-process locking." Therefore the **server's store** (users/projects/sessions/mirror) and each **session's Pi Durable store** are separate SQLite files, owned by separate processes. The server never opens a session's Pi Durable DB.

## Architecture Decisions

Each becomes an ADR at `docs/architecture/adrs/` during M1.

### ADR-1 — IPC: newline-delimited JSON over stdio
Parent writes JSON requests to child `stdin`; child writes JSON responses and notifications to `stdout`; child logs go to `stderr` only. Requests carry `{ id, method, params }`; notifications carry `{ method, params }`. Rationale: no socket file lifecycle or stale-socket cleanup, no port allocation, child death is observable as process exit, and the pipe is naturally scoped to the session. Unix sockets rejected: extra cleanup on crash, no lifecycle coupling.

### ADR-2 — Credential injection: proxy `CredentialStore`
Server passes only `authMethodId` and `provider` at `init`. The harness implements `CredentialStore` (`read`/`list`/`modify`/`delete`) and proxies each call to the server over IPC. The server decrypts, returns the credential, and re-encrypts on `modify`. Rationale: plaintext exists only in the harness process; OAuth refresh (which Pi performs inside `modify`) persists automatically and survives restarts. Env-var injection rejected: no write-back path, so rotated refresh tokens would be lost.

### ADR-3 — Encryption: AES-256-GCM with a server-held key
`crypto.subtle` AES-GCM, 256-bit key from `NEXUS_SECRET_KEY_FILE` (0600, generated on first run if absent), random 12-byte IV per record, ciphertext envelope `v1.<iv-b64>.<tag-b64>.<ct-b64>`. Rationale: standard AEAD, no plaintext keys at rest, no third-party dependency.

### ADR-4 — Storage: SQLite on both sides
Server store via `bun:sqlite` directly. Session stores via Pi Durable portable `SqliteStorage` + a `SqliteDatabase` facade over `bun:sqlite` (`src/harness/bun-sqlite.ts`), because `node:sqlite` is unavailable on Bun. WAL + `synchronous=NORMAL`.

### ADR-5 — HTTP authentication: out-of-band bearer tokens
Users are principals seeded via CLI/config; each holds a bearer token stored hashed (`Bun.password`, argon2id). Requests resolve `Authorization: Bearer` → user. Per-user ownership is enforced on every project/session route. Rationale: spec §12 permits out-of-band issuance and requires only ownership enforcement.

### ADR-6 — Model selection is per-session with a server default
Spec is silent, but Pi requires a model to generate. `POST /projects/:id/sessions` accepts optional `model: { provider, modelId }`; config `NEXUS_DEFAULT_MODEL` supplies the fallback. Rationale: without it, generation cannot run.

### ADR-7 — Deletion preserves branches
`DELETE /sessions/:id` removes the worktree and stops the process, but leaves branch `pi/<sessionName>` and reports it in the response (`preservedBranch: true`). Rationale: spec §7 default; worktrees are the isolation boundary, branches may hold work.

## Repository Layout

```
package.json                 # bun; scripts: dev, start, test, typecheck, lint
tsconfig.json                # strict, noUncheckedIndexedAccess, verbatimModuleSyntax
src/
  config.ts                  # env parsing, defaults, validation
  types.ts                   # domain types (User, AuthMethod, Project, Session, MessageMirror)
  server/
    main.ts                  # Bun.serve bootstrap, route table
    router.ts                # method+path matching, JSON error envelope
    principal.ts             # bearer → User
    routes/projects.ts       # register/list/get/content/git
    routes/sessions.ts       # create/list/get/delete/messages/events/abort
  store/
    db.ts                    # bun:sqlite open, PRAGMAs, migration runner
    migrations.ts            # ordered schema versions
    users.ts auth-methods.ts projects.ts sessions.ts messages.ts
  crypto/secrets.ts          # encrypt/decrypt envelope
  projects/
    registry.ts              # register/validate (exists, dir, git repo, no dup path)
    content.ts               # path-safe read-only listing/reading
    git.ts                   # status/log/worktrees via execFile("git", argv)
  sessions/
    supervisor.ts            # spawn/track/restart/stop, status machine, crash marking
    worktree.ts              # add/remove/list; per-project mutex
    ipc.ts                   # framed JSON codec + typed client (server side)
    mirror.ts                # entry → message_mirror rows, idempotent upsert
    events.ts                # SSE hub: fanout to N clients, snapshot-on-attach
  harness/                   # the child process (ADR-1)
    main.ts                  # open Harness, serve RPC, stream events
    protocol.ts              # shared request/notification types (imported by both sides)
    bun-sqlite.ts            # SqliteDatabase facade over bun:sqlite
    credentials.ts           # proxy CredentialStore
    runtime.ts               # registry, models, settings, env wiring
test/
  unit/  integration/  fixtures/
```

## Component Specifications

### Server store (`src/store`)
Tables: `users`, `auth_methods`, `projects`, `sessions`, `message_mirror`, `request_dedup`.
- `projects.path` UNIQUE → duplicate registration is a deterministic `409`.
- `sessions.id` is also the Pi conversation id (spec §6.1).
- `message_mirror` PK `(session_id, entry_id)`, plus server-assigned `sequence` (monotonic per session) — upsert makes harness restarts idempotent.
- `request_dedup` PK `(session_id, request_id)` → `submission_id`; second layer under Pi's own dedup so a retry answers without a round trip.

### Crypto (`src/crypto/secrets.ts`)
`encryptSecret(plaintext) → envelope`, `decryptSecret(envelope) → plaintext`. Key loaded once from `NEXUS_SECRET_KEY_FILE`; failure to load a malformed key is fatal at boot.

### Content API (`src/projects/content.ts`)
Resolve `path.resolve(projectRoot, requested)`, then require `resolved === root || resolved.startsWith(root + sep)` after `fs.realpath` on the root. Directory → entry list; file → text with size cap. Reject symlinks escaping the root. Unit-tested against `..`, absolute paths, `%2e%2e`, and symlink escapes.

### Git API (`src/projects/git.ts`)
`execFile("git", argv, { cwd: projectPath })`, never a shell. `status` → porcelain=v2 parse; `log` → `--pretty` with a bounded `-n`; `worktrees` → `git worktree list --porcelain`. Read-only.

### Worktree management (`src/sessions/worktree.ts`)
- Create: `git worktree add -b pi/<sessionName> <root>/.pi-worktrees/<project>/<sessionId> <baseRef>`.
- Remove: `git worktree remove` (no `--force` when clean); `--force` only when the caller passes `force=true`. Branch preserved (ADR-7).
- A per-project promise-chain mutex serializes create/remove (spec §7 concurrent creation).

### Supervisor (`src/sessions/supervisor.ts`)
States: `starting → idle ⇄ running → stopped | crashed`.
- Spawn `bun src/harness/main.ts` with `cwd = worktreePath`, env carrying `NEXUS_SESSION_ID`, `NEXUS_HARNESS_DB`, `NEXUS_SERVER_IPC` (see protocol).
- `run_start`/`run_end` notifications drive `idle`/`running`.
- Child exit while not intentionally stopped → `crashed`, PID cleared, worktree kept.
- `restart(sessionId)`: respawn; the harness opens the same DB and calls `harness.resume()`; pending work continues from the last checkpoint.
- `stop(sessionId)`: graceful `shutdown` RPC, then SIGTERM, then SIGKILL after a timeout.

### IPC protocol (`src/harness/protocol.ts`)
Server → harness: `init`, `submit`, `abort`, `status`, `shutdown`.
Harness → server: `ready`, `event` (AgentEvent batch), `entry` (EntryRecord), `credential.read`, `credential.modify`, `fault`.
`stdout` carries protocol frames only; all harness logging goes to `stderr`.

### Harness process (`src/harness/main.ts`)
On start: open `SqliteStorage` over `bun:sqlite`, build `builtinModels({ credentials: proxyStore })`, `createRegistry()` + `install(CodingTools)`, `Harness.open(storage, { models, registry, settings, env }, BACKGROUND_CONTEXT)`, `root()` with `{ agent: { model, cwd: worktreePath } }`, `harness.resume()`, then attach `watchEvents(harness, root.id, ctx)` and forward batches as `event` notifications plus each new `EntryRecord` as `entry`.
- `env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? worktreePath })` scopes tools to the worktree.
- `settings`: compaction enabled, `toolExecution: "parallel"`, stream timeout and retry from config.
- `submit` forwards `{ type: "input", content, requestId }`; Pi's dedup plus `request_dedup` give exactly-once.

### Mirror (`src/sessions/mirror.ts`)
Each `entry` notification upserts into `message_mirror` keyed by `(session_id, entry_id)`. Mapping: `pi.user` → `user`, `pi.assistant` → `assistant` (tool calls extracted from `model[0].content`), `pi.tool-result` → `tool`, `pi.reset`/`pi.compaction`/`pi.system` → `meta` markers. Independent of Pi compaction, satisfying §3.4.

### Event surface (`src/sessions/events.ts`)
`GET /sessions/:id/events` returns `text/event-stream`. On attach, replay the harness's current `snapshot` event, then stream subsequent batches. N clients attach concurrently; slow clients drop to the newest snapshot (Pi already collapses overflow). SSE `id:` is the per-session batch counter so a reconnect can be detected.

## Milestones

Each milestone ends with its listed verification actually executed.

### M1 — Project registry, content API, git state (no sessions)
`package.json`, `tsconfig.json`, `src/config.ts`, `src/types.ts`, `src/store/*`, `src/crypto/*`, `src/projects/*`, `src/server/*`, routes for `/projects` and `/projects/:id/{content,git/*}`.
**Verify:** register a real git folder → `201`; register the same path → `409`; register a non-git folder → `422`; `curl` content for `../../etc/passwd` → `400`; `git/status` on a dirty repo shows the dirty file; `bun test test/unit/content-path.test.ts test/unit/secrets.test.ts`.

### M2 — One session, IPC and event streaming (no worktrees)
`src/harness/*` (minus worktree cwd), `src/sessions/ipc.ts`, `supervisor.ts`, `mirror.ts`, `events.ts`, session routes. Spawn the harness with the project path as cwd.
**Verify:** create a session → `ready` → `POST /messages` → SSE client receives `snapshot` then `message_*` then `run_end`; `GET /messages` shows the mirrored transcript; a second SSE client attached mid-run receives a snapshot then deltas, not a replay.

### M3 — Worktree per session, lifecycle, deletion, crash recovery
`src/sessions/worktree.ts`, per-project mutex, deletion semantics, restart path.
**Verify:** create two sessions → two distinct worktrees and branches under `.pi-worktrees/`; editing in one leaves `git status` of the other clean; `DELETE` removes the worktree and preserves the branch; `kill -9` the harness → session reads `crashed` → `POST /restart` → conversation resumes with full history.

### M4 — Users, auth methods, per-project assignment
`users.ts`, `auth-methods.ts`, `principal.ts`, `credentials.ts`, assignment route.
**Verify:** a second user cannot read the first user's project (`403`/`404`); assigning an auth method and creating a session injects the credential (assert via `models.getAuth` in the harness); credential round-trip encryption test; a project with no auth method refuses to start a session with a clear error.

### M5 — Hardening
Type check, lint, full test suite, README documenting IPC, credential mechanism, worktree layout, and deletion policy.

## Test Plan

Derived from `INPUT.md` §8. Keyless by construction via `fauxProvider`.
- Unit: path containment (`content-path.test.ts`), encryption round-trip (`secrets.test.ts`), protocol framing (`ipc-framing.test.ts`).
- Integration: project registration accept/reject; session lifecycle create → worktree exists → message → events → delete → worktree gone; crash recovery (kill child, restart, assert history + resumed answer); exactly-once (`requestId` twice → one `pi.user` row); mirror survives a compaction (`compact()` then assert all original entries remain).
- Harness: `faux` responses scripted; `stopReason: "toolUse"` required for tool rounds (verified — default `"stop"` skips tool execution).

## Configuration

| Key | Meaning |
|---|---|
| `NEXUS_PROJECTS_ROOT` | Where project folders and `.pi-worktrees/` live |
| `NEXUS_DATA_DIR` | Server SQLite + secret key file |
| `NEXUS_PI_STORAGE_DIR` | Per-session Pi Durable SQLite files |
| `NEXUS_LISTEN` | host:port for `Bun.serve` |
| `NEXUS_SECRET_KEY_FILE` | AES-256-GCM key (0600) |
| `NEXUS_DEFAULT_MODEL` | `provider:modelId` fallback (ADR-6) |

## Risks

- **Pi Durable is experimental and unpinned upstream.** Exact pin `1.1.0` in `package.json`; isolate every Pi call behind `src/harness/*` so a version bump touches one directory.
- **Bun/`node:sqlite` gap.** Mitigated by the portable core + `bun:sqlite` facade (verified working). If Bun later adds `node:sqlite`, the facade stays as the Bun path.
- **Harness crash mid-tool.** Pi reruns only `replay: "safe"` tools; others get an `interrupted` result. Documented, not worked around.
- **Credential store round-trip on the hot path.** Only on auth resolution, not per token; acceptable.

## Definition of Done Mapping

| `INPUT.md` §11 criterion | Milestone |
|---|---|
| Register project, assign auth, list projects | M1, M4 |
| Read-only content + git with traversal prevented | M1 |
| Concurrent isolated sessions | M3 |
| Prompts + attachable event stream | M2 |
| History persisted independent of compaction | M2, M5 test |
| Kill/restart resumes from checkpoint | M3 |
| Tests pass, linter and type checker clean | M5 |

## Related

- `INPUT.md` — requirements
- `docs/architecture/pi-durable-api.md` — verified API surface and probe scripts
- `docs/architecture/adrs/` — ADR-1 … ADR-7
