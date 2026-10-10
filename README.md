# nexus

A durable agent session control plane: an HTTP server that registers git repositories as projects and supervises one Pi Durable harness process per agent session, each isolated in its own git worktree.

## What it is

The server does not run an agent loop. It is a supervisor and control plane:

```
HTTP client ──▶ server (Bun.serve)
                 │
                 ├── users, projects, auth methods, message mirror (server.sqlite)
                 ├── read-only content API (path-contained)
                 ├── read-only git API
                 └── stdio JSON-RPC ──▶ harness process (Pi Durable)
                                            cwd = session worktree
                                            tools scoped to the worktree
```

- One OS process per session, one git worktree per session, one branch per session.
- Conversations are durable: killing a harness process and restarting it resumes from the last committed checkpoint.
- The full transcript is mirrored into the server's own store, so it survives Pi Durable compaction.

## Requirements

- Bun ≥ 1.3 (Bun lacks `node:sqlite`, so the portable Pi Durable storage core is used over a `bun:sqlite` facade — see `docs/architecture/adrs/0004-storage.md`).
- `git` on `PATH`.
- `@earendil-works/pi-durable` pinned exactly at `1.1.0`.

## Running

```bash
bun install
NEXUS_DATA_DIR=~/.nexus \
NEXUS_PROJECTS_ROOT=~/nexus-projects \
NEXUS_LISTEN=127.0.0.1:8787 \
NEXUS_DEFAULT_MODEL=anthropic:claude-sonnet-4-6 \
bun run src/server/main.ts
```

On the first run the server creates a user `owner` and prints a bearer token **once**. Every request needs `Authorization: Bearer <token>`.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `NEXUS_PROJECTS_ROOT` | `~/nexus-projects` | Where project folders and `.pi-worktrees/` live |
| `NEXUS_WORKTREES_ROOT` | `NEXUS_PROJECTS_ROOT` | Where session worktrees are created |
| `NEXUS_DATA_DIR` | `~/.nexus` | Server SQLite, secret key, default session storage |
| `NEXUS_PI_STORAGE_DIR` | `<dataDir>/sessions` | One Pi Durable SQLite file per session |
| `NEXUS_LISTEN` | `127.0.0.1:8787` | `host:port` for `Bun.serve` |
| `NEXUS_SECRET_KEY_FILE` | `<dataDir>/secret.key` | AES-256-GCM key, mode 0600, created on first run |
| `NEXUS_DEFAULT_MODEL` | — | `provider:modelId` used when a session does not name one |
| `NEXUS_BOOTSTRAP_TOKEN` | random | Secret half of the first user's bearer token |
| `NEXUS_WEB_DIR` | — | Directory holding the built web app; when set, unmatched `GET`s are served from it with an `index.html` fallback |
| `NEXUS_COMPACTION_RESERVE_TOKENS` | `16384` | Context headroom before a compaction is forced |
| `NEXUS_COMPACTION_KEEP_RECENT_TOKENS` | `20000` | Roughly how much recent context stays verbatim |
| `NEXUS_PROVIDERS_MODULE` | — | Module whose default export registers extra model providers; used for offline runs and tests |

## HTTP API

Every route requires a bearer token except `POST /login`, and every route is scoped to the caller. Another user's project or session is a `404`, never a `403`.

### Identity

| Method | Path | Notes |
|---|---|---|
| `POST` | `/login` | `{ handle, secret }` → `{ token, user }`. The only unauthenticated route; `401` on a bad handle or secret |
| `GET` | `/me` | The authenticated user, so a client can validate a stored token |

`POST /login` verifies the secret against its stored hash and reconstructs the bearer token, which is why the secret must not contain `_` (see `docs/architecture/adrs/0005-user-authentication.md`).

### Projects

| Method | Path | Notes |
|---|---|---|
| `POST` | `/projects` | `{ path, name? }`; validates the path is a directory and itself a git repository. `422` when invalid, `409` when the path is already registered |
| `GET` | `/projects` | The caller's projects |
| `GET` | `/projects/:id` | Project metadata |
| `GET` | `/projects/:id/content?path=` | Read-only listing or file text. `400` when the path escapes the project root |
| `GET` | `/projects/:id/git/status` | Branch, dirty files, ahead/behind |
| `GET` | `/projects/:id/git/log?limit=` | Recent commits |
| `GET` | `/projects/:id/git/worktrees` | Linked worktrees |
| `PUT` | `/projects/:id/auth-method` | `{ authMethodId }` or `{ authMethodId: null }` to unassign |

### Auth methods

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth-methods` | `{ type: "api_key", provider, label?, key }` or `{ type: "oauth", provider, label?, credential: { refresh, access, expires } }`. The credential is encrypted before storage and never returned |
| `GET` | `/auth-methods` | Metadata only — no secret material |
| `DELETE` | `/auth-methods/:id` | Removes the method and clears it from any project using it |

A project with no assigned auth method refuses to start a session with `400`.

### Sessions

| Method | Path | Notes |
|---|---|---|
| `POST` | `/projects/:id/sessions` | `{ name, model?, baseRef? }` — creates the worktree and spawns the harness. `409` on a duplicate name, `400` without an auth method |
| `GET` | `/projects/:id/sessions` | Sessions in a project |
| `GET` | `/sessions/:id` | Session metadata, including `status`, `pid`, `worktreePath`, `branch` |
| `DELETE` | `/sessions/:id?force=` | Stops the process, removes the worktree, deletes the session's records; preserves the branch |
| `POST` | `/sessions/:id/restart` | Restarts a crashed or stopped harness; the conversation resumes from its last checkpoint |
| `POST` | `/sessions/:id/messages` | `{ requestId, text }`; returns `202` with the submission id. Repeating a `requestId` is a no-op |
| `GET` | `/sessions/:id/messages?limit=` | The mirrored transcript, independent of Pi Durable compaction |
| `POST` | `/sessions/:id/abort` | Stops the running turn |
| `GET` | `/sessions/:id/events` | Server-sent events. `409` while no process is running |

Session status is one of `starting`, `idle`, `running`, `stopped`, `crashed`.

### Event stream

Each subscriber gets its own Pi Durable attachment, so the snapshot and the registration for later commits are captured atomically. A client attaching mid-run receives `session_status`, then a `snapshot` of committed state, then incremental `AgentEvent`s — never a replay from zero. More than one client may attach to a session.

## Inter-process protocol

The server and each harness process exchange newline-delimited JSON over the child's stdio: one object per line, requests carrying an `id`, notifications without one. `stdout` carries protocol frames only; the harness sends all logging to `stderr`.

| Direction | Methods |
|---|---|
| server → harness | `init`, `submit`, `abort`, `subscribe`, `unsubscribe`, `shutdown` |
| harness → server | `ready`, `event`, `entry`, `status`, `fault`, `credential.read`, `credential.list`, `credential.modify`, `credential.delete` |

A request handler never blocks the read loop, because the credential proxy issues requests back to the peer while handling one.

## Credentials

- An auth method is either an API key or an OAuth token set, sealed with AES-256-GCM under a 0600 key file (`docs/architecture/adrs/0003-credential-encryption.md`).
- The harness never receives credentials at spawn time. It implements Pi Durable's `CredentialStore` and proxies each call to the server, which decrypts on read and re-encrypts on write. OAuth refreshes therefore persist, and plaintext exists only inside the harness process (`docs/architecture/adrs/0002-credential-injection.md`).
- A session may only see its project's assigned auth method, and only for the matching provider.

## Worktree layout

```
<projectsRoot>/
  <projectName>/                     # main checkout, registered in place
  .pi-worktrees/
    <projectName>/
      <sessionId>/                   # git worktree, branch pi/<sessionName>
```

Worktrees live outside the main checkout so `git status` and tools that walk the repository stay clean. `git worktree add` and `git worktree remove` are serialized per project. The harness process runs with the worktree as its working directory, and Pi's tools are scoped to it by `NodeExecutionEnv`.

## Deleting a session

`DELETE /sessions/:id` stops the process, removes the worktree, and deletes the session row, its mirrored transcript, its request-dedup rows, and its Pi Durable storage file. The branch is **always preserved**.

A worktree holding uncommitted work is refused with `409`; pass `?force=true` to discard it. See `docs/architecture/adrs/0007-session-deletion.md`.

## Crash recovery

If a harness process dies, the session becomes `crashed` and its worktree is left untouched. `POST /sessions/:id/restart` spawns a new process over the same storage; Pi Durable resumes the interrupted run from its last committed checkpoint, and the mirror keeps the full history. Sessions left live by a previous server process are marked `crashed` at boot.

## Web frontend

`apps/web` is a browser frontend over this API: register projects, manage auth methods, create sessions, and watch a conversation stream live. It exists to exercise every route, so it is also the most complete test of the server.

It shares the API's origin — no CORS anywhere (ADR-8). In development Vite proxies `/api` to the server; in production the server serves the built app.

```bash
# development: the API on 8787, Vite on 5173 proxying /api
bun run dev
cd apps/web && bun run dev

# production: build, then point the server at the output
cd apps/web && bun run build
NEXUS_WEB_DIR=apps/web/dist bun run src/server/main.ts
```

Log in with the `owner` handle and the secret behind the bootstrap token. `@nexus/client` holds the wire contract the server and every frontend share, so a breaking change fails `tsc` rather than reaching a browser.

## Development

```bash
bun test           # unit + integration (integration spawns real harness processes)
bun run typecheck  # tsc --noEmit
bun run lint       # biome check
bun run lint:fix
```

Integration tests run keyless: `test/fixtures/faux-provider.ts` is loaded into each harness through `NEXUS_PROVIDERS_MODULE` and answers from a script.

## Documentation

- `docs/INDEX.md` — navigation
- `docs/plans/pi-session-server.md` — the server's implementation plan and milestone status
- `docs/plans/web-frontend.md` — the frontend plan
- `docs/architecture/pi-durable-api.md` — the Pi Durable calls this project depends on, verified by execution
- `docs/architecture/adrs/` — architecture decision records
