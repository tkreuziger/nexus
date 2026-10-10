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
| `NEXUS_SSE_HEARTBEAT_MS` | `20000` | Interval between `: keep-alive` comments on an event stream, which is what stops Bun closing an idle attachment |
| `NEXUS_COMPACTION_RESERVE_TOKENS` | `16384` | Context headroom before a compaction is forced |
| `NEXUS_COMPACTION_KEEP_RECENT_TOKENS` | `20000` | Roughly how much recent context stays verbatim |
| `NEXUS_PROVIDERS_MODULE` | — | Module whose default export registers extra model providers; used for offline runs and tests |
| `NEXUS_SKILLS_DIR` | — | Extra skill roots, `:`-separated, added to the Pi locations skills are discovered from |

## HTTP API

Every route requires a bearer token except `POST /login`, and every route is scoped to the caller. Another user's project or session is a `404`, never a `403`.

**Every route lives under the `/api` prefix.** The web app owns the rest of the URL space, so a browser navigation to `/projects/anything` loads the app rather than matching `GET /projects/:id` — a document load cannot carry a bearer token, and without the split it returned a `401` instead of a page.

### Identity

| Method | Path under `/api` | Notes |
|---|---|---|
| `POST` | `/login` | `{ handle, secret }` → `{ token, user }`. The only unauthenticated route; `401` on a bad handle or secret |
| `GET` | `/me` | The authenticated user, so a client can validate a stored token |

`POST /login` verifies the secret against its stored hash and reconstructs the bearer token, which is why the secret must not contain `_` (see `docs/architecture/adrs/0005-user-authentication.md`).

### Catalogue

| Method | Path under `/api` | Notes |
|---|---|---|
| `GET` | `/providers` | Every provider Pi knows, with the auth each accepts and how many models it offers |
| `GET` | `/providers/:id/models` | One provider's chat models with context window, output limit, and price per million tokens. `404` for an unknown provider |

The catalogue is built from the same `Models` collection a harness uses, plus anything
`NEXUS_PROVIDERS_MODULE` registers. That shared origin is what makes it authoritative: a provider or
model it does not list is one a harness could not resolve either — it would fail the generation with
`getModel` returning nothing. Naming one is therefore refused at the API, where the error can be
specific, instead of mid-turn.

An auth method may only name a known provider, and only for an auth type that provider accepts. A
session may only name a known model of a known provider.

### Filesystem

| Method | Path under `/api` | Notes |
|---|---|---|
| `GET` | `/fs/list?path=&limit=` | The immediate subdirectories of `path`, each with a `git` flag; `path` defaults to the server's home directory and a leading `~` expands to it. `422` when `path` is not a directory; `limit` defaults to 200 (max 500) |

This exists only to autocomplete the path field when registering a project. It is read-only and, unlike
the project and session routes, not owner-scoped: registering already accepts any path on the server's
filesystem, so listing directory names grants no new capability.

### Projects

| Method | Path under `/api` | Notes |
|---|---|---|
| `POST` | `/projects` | `{ path, name? }`; validates the path is a directory and itself a git repository. `422` when invalid, `409` when the path is already registered |
| `GET` | `/projects` | The caller's projects |
| `GET` | `/projects/:id` | Project metadata |
| `GET` | `/projects/:id/content?path=` | Read-only listing or file text. `400` when the path escapes the project root |
| `GET` | `/projects/:id/search?q=&limit=` | Read-only case-insensitive content search. Skips `.git`, `node_modules`, binaries, and files over 1 MiB; symlinks are not followed. `limit` defaults to 100 (max 500); `truncated` marks a capped result. `400` when `q` is empty |
| `GET` | `/projects/:id/git/status` | Branch, dirty files, ahead/behind |
| `GET` | `/projects/:id/git/log?limit=` | Recent commits |
| `GET` | `/projects/:id/git/worktrees` | Linked worktrees |
| `PUT` | `/projects/:id/auth-method` | `{ authMethodId }` or `{ authMethodId: null }` to unassign |

### Auth methods

| Method | Path under `/api` | Notes |
|---|---|---|
| `POST` | `/auth-methods` | `{ type: "api_key", provider, label?, key }` or `{ type: "oauth", provider, label?, credential: { refresh, access, expires } }`. The credential is encrypted before storage and never returned |
| `GET` | `/auth-methods` | Metadata only — no secret material |
| `DELETE` | `/auth-methods/:id` | Removes the method and clears it from any project using it |

A project with no assigned auth method refuses to start a session with `400`.

### Sessions

| Method | Path under `/api` | Notes |
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

## Skills

Every session's agent discovers [Pi skills](https://agentskills.io/specification) from the locations `pi` itself uses, so a skill installed for the CLI is available to a session without copying it:

- `~/.pi/agent/skills/` — the global root; `PI_CODING_AGENT_DIR` moves the agent directory it sits in
- `~/.agents/skills/` — the shared convention, so skills installed for other harnesses work too
- `<worktree>/.pi/skills/` and `<worktree>/.agents/skills/` — the session's worktree, so a project's committed skills travel with the branch it was created from
- every root named in `NEXUS_SKILLS_DIR` (`:`-separated)

Discovery, validation, and the prompt block are Pi's own loader, `@earendil-works/pi-coding-agent` (see `docs/architecture/adrs/0010-skills.md`). Only names and descriptions enter the system prompt; the model loads a skill's body through `read` when a task matches its description, exactly as `pi` does. The section is rendered before every request, so a skill added to a root is advertised on the next turn without restarting the session.

The loader reports malformed skills on the harness's stderr (`journalctl -u nexus`) and skips them — a skill without a `description` is never advertised.

A skill is instructions the model will follow and may include code it runs. Review skill content before installing it; a project's committed skills are exactly as trustworthy as the repository.

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

A web manifest and icons ship with the app, so it can be added to a home screen with a name, an icon, and a standalone window. Installing it as an app additionally needs a service worker, which does not exist yet — that is the next step for the PWA path, not a missing piece of this one.

## Deploy

`deploy/nexus.service` (systemd; runs as root, because a project is a folder on the host and each session's harness tools are scoped to that folder's worktree) and `deploy/apache/` (the vhost pair: port 80 redirects, port 443 terminates TLS and proxies to the loopback server). Edit the paths for your host, then:

```sh
bun install
bun run web:build              # apps/web/dist — served live, no restart needed
install -m 0644 deploy/nexus.service /etc/systemd/system/nexus.service
systemctl daemon-reload && systemctl enable --now nexus

install -m 0644 deploy/apache/nexus.conf /etc/apache2/sites-available/nexus.conf
a2ensite nexus && apache2ctl configtest && systemctl reload apache2
certbot --apache -d nexus.tristech.de --redirect   # writes nexus-le-ssl.conf

# certbot's vhost, plus the proxy block: swap in the copy that carries it.
install -m 0644 deploy/apache/nexus-le-ssl.conf /etc/apache2/sites-available/nexus-le-ssl.conf
apache2ctl configtest && systemctl reload apache2
```

Three things the unit settles that are easy to get wrong:

- **State outside the checkout.** `NEXUS_DATA_DIR=/var/lib/nexus` holds the server SQLite, the AES key and every session's Pi storage; `NEXUS_PROJECTS_ROOT=/root/nexus-projects` holds worktrees. A re-clone or a rebuild must not be able to destroy either.
- **The first boot prints the credential.** With `NEXUS_BOOTSTRAP_TOKEN` unset the server creates user `owner` with a random secret and logs the bearer token once — `journalctl -u nexus | grep -A1 'bearer token'`. The login form wants the *secret* (the last `_`-separated part); the curl and the web client want the whole token.
- **`flushpackets=on` is what makes the vhost stream.** Without it `mod_proxy_http` buffers, and `GET /api/sessions/:id/events` arrives in one lump when the turn ends instead of incrementally — the web app's live view then looks broken while the API is fine. `ProxyTimeout` is set well above the stream's 20s heartbeat.

The unit's `WorkingDirectory` is the checkout itself, and the two halves reload differently: the server reads its own sources once at start, so a change under `src/` or `packages/` needs `systemctl restart nexus`, while `NEXUS_WEB_DIR` is re-read from disk on every request, so `bun run web:build` is live on the next page load with no restart at all. That asymmetry is the trap — a rebuilt bundle against an unrestarted server pairs a fresh client with a stale API. (A browser may also still hold the previous `index.html`; the hashed asset names change, so a reload is enough.)

For iteration, `bun run dev` (server with `--watch`) and `bun run web:dev` (Vite on 5173, proxying `/api`) are the fast path. Stop `nexus.service` first or point `NEXUS_LISTEN` at another port: a dev run inherits no `NEXUS_*` from the unit, so it would also default to `~/.nexus` and `~/nexus-projects` rather than the deployed state.

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
