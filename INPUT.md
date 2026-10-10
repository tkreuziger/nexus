# Project: Pi Session Server — A Durable Agent Session Control Plane

## 1. Project Overview

Build a simple HTTP server that manages "projects" (git repositories on disk) and "agent sessions" (long-running AI coding-agent conversations built on the Pi Durable harness). The server is a control plane for registering projects, reading their contents and git state, and starting and interacting with multiple concurrent agent sessions per project. Each session is isolated in its own git worktree and runs in its own OS process.

The underlying agent runtime is **Pi Durable** (`@earendil-works/pi-durable`), an experimental durable-execution harness from Earendil for building Pi-style agents. It provides a durable conversation primitive: model calls, tool execution, checkpoints, crash recovery, compaction, multi-client attachment, and committed state. The server does **not** reimplement the agent loop. It supervises Pi Durable harness processes and re-exposes their conversation surface over HTTP.

The Pi Durable version must be pinned exactly. Treat its API as stable for the lifetime of this project; deliberate version bumps are the responsibility of the maintainer.

## 2. Goals

- Provide a small, understandable server that abstracts Pi Durable conversations into named, folder-scoped **projects** and **sessions**.
- Let a user register a folder as a project and inspect its files (read-only) and git state.
- Let a user create multiple concurrent agent sessions within a project, each with its own git worktree and its own harness process, so sessions cannot conflict with each other's edits.
- Let a user send prompts to a session and receive the agent's responses and events.
- Persist the full message history so all messages remain visible even after Pi Durable compaction summarizes older context.
- Support a minimal user layer: every project has an owner; users have stored authentication methods; each project is assigned one auth method.
- Keep the V1 surface small and the architecture simple. Prefer a single server process supervising child processes over distributed infrastructure.

## 3. Requirements

### 3.1 Users and Authentication

- Minimal user layer. Each user has an identity in the server's store.
- Each user can have multiple stored auth methods. An auth method is either:
  - an API key for a provider, or
  - an OAuth credential (refresh token / token set) for a subscription provider.
- An auth method carries at minimum: ID, owner user ID, type (`api_key` or `oauth`), provider, label, encrypted credential blob, created and last-used timestamps.
- Credentials must be stored encrypted at rest. Do not store plaintext API keys.
- Each project is assigned exactly one auth method, drawn from its owner's methods. This auth method is used when spawning the project's session processes.
- No project sharing: a project is visible only to its owner.

### 3.2 Projects

- A project is a folder on disk that is a git repository. The folder itself is the source of truth for content and git state.
- Registering a project records: ID, owner user ID, display name, absolute path, assigned auth method ID, and timestamps.
- The project content API is **read-only in V1**.
- Path traversal must be prevented: content requests must be contained within the project folder.

### 3.3 Sessions

- A session is one Pi Durable conversation plus one git worktree plus one harness process.
- Multiple sessions may exist concurrently in one project.
- Each session gets its own git worktree and its own branch, so sessions cannot produce conflicting edits to the same working tree.
- Worktrees must live outside the project's main checkout, so they do not pollute `git status` or confuse tools that walk the repo. Default to a sibling directory tree, configurable.
- One OS process per session, running the Pi Durable harness with that session's worktree as its working directory.
- The server supervises these processes: it spawns, tracks, restarts, and stops them, and marks crashed sessions.
- Sessions are resumable. If a session process dies, the server must be able to restart it and Pi Durable must resume from the last committed checkpoint.
- Session metadata (name, project, worktree path, branch, base ref, status, PID, timestamps) lives in the server's store. The Pi Durable conversation state lives in Pi Durable's own storage. SQLite is a sensible default for both.
- Session lifecycle states must be observable: at least `starting`, `idle`, `running`, `stopped`, `crashed`.

### 3.4 Conversation Interaction

- A client can send a user message (prompt) to a session and receive the agent's response and intermediate events.
- The events surface must be attachable at any time. A late-joining client receives current committed state and then incremental changes, not a full replay from zero.
- Message submission must be exactly-once from the client's point of view. Clients may retry after a crash; a client-supplied request identifier must deduplicate submissions.
- The server must persist the full message history — all user messages, assistant messages, tool calls, and tool results — independent of Pi Durable compaction, so a UI can render the complete transcript.

### 3.5 Git State

- The server exposes read-only git state per project: current branch, dirty files, ahead/behind status, commit log, and the list of worktrees.
- Session creation and deletion must create and remove worktrees correctly.

## 4. Functional Behavior

### 4.1 Project lifecycle

1. A user registers a folder as a project. The server validates that the path exists, is a directory, and is a git repository, then records the project.
2. The user assigns one of their auth methods to the project.
3. The user can list their projects and fetch one project's metadata, content, and git state.

### 4.2 Session lifecycle

1. The user creates a session under a project, supplying a name.
2. The server creates a new git worktree and branch for the session, then spawns a Pi Durable harness process with that worktree as its working directory, configured with the project's assigned auth method.
3. The user sends prompts to the session and receives events.
4. On session deletion, the server stops the process and removes the worktree.
5. If a session process exits unexpectedly, the server marks the session `crashed` and can restart it on request, resuming from the last checkpoint.

### 4.3 Observing a session

- A client subscribes to a session's event stream. On subscribe, the server sends current committed state, then streams subsequent changes.
- Any number of clients may attach to the same session.

## 5. Architecture and Technical Constraints

### 5.1 Runtime and language

- Implement in **TypeScript on Bun**, since Pi Durable is JS-runtime-native and runs on Node, Bun, or Cloudflare Durable Objects. If the repository already targets another JS runtime, follow the repository.
- Pin the Pi Durable version exactly in the dependency manifest.

### 5.2 Process and supervision model

```
HTTP client ──▶ server (supervisor, control plane)
                 │
                 ├── user / project / auth registry
                 ├── content API (read-only)
                 ├── git API (read-only)
                 └── per-session IPC ──▶ harness process (Pi Durable)
                                            cwd = session worktree
                                            tools scoped to worktree
```

- The server does **not** embed the agent loop. It spawns one harness process per session and communicates with it over local IPC (a Unix socket or stdio RPC is acceptable; choose one and document it).
- The server re-exposes the harness conversation surface to HTTP clients.

### 5.3 Worktree layout

Default, configurable:

```
<projectsRoot>/
  <projectName>/                  # main checkout
  .pi-worktrees/
    <projectName>/
      <sessionId>/                # git worktree, branch pi/<sessionName>
```

### 5.4 Authentication injection

- Pi resolves credentials with a priority order roughly: explicit CLI/API-key argument → `auth.json` config → environment variables → custom provider config.
- Pi stores interactive/OAuth credentials in `~/.pi/agent/auth.json` with strict permissions (0600 file, 0700 directory).
- When spawning a session process for a project, the server must load that project's assigned auth method, decrypt the credential, and inject it into the harness process — either as environment variables or through the `Models` collection that the Pi Durable runner accepts. Pick one mechanism and document it.
- OAuth-based methods require token refresh. The server is responsible for providing a valid token when spawning a session.

## 6. Data and Interfaces

### 6.1 Domain entities

```
User {
  id, name/handle, createdAt
}

AuthMethod {
  id, userId, type: "api_key" | "oauth",
  provider, label,
  credentialCiphertext, createdAt, lastUsedAt
}

Project {
  id, ownerId, name, path,
  assignedAuthMethodId, createdAt
}

Session {
  id,                       // also used as the Pi conversation id
  projectId, name,
  worktreePath, branch, baseRef,
  status: "starting" | "idle" | "running" | "stopped" | "crashed",
  pid?, createdAt
}

MessageMirror {
  sessionId, sequence, role, content,
  toolCalls?, toolResults?, createdAt
}
```

- `MessageMirror` exists so the full transcript survives Pi Durable compaction.

### 6.2 HTTP API (v1)

```
POST   /projects                     register a folder
GET    /projects
GET    /projects/:id
GET    /projects/:id/content?path=   list/read files (path-safe, read-only)
GET    /projects/:id/git/status      dirty files, branch, ahead/behind
GET    /projects/:id/git/log
GET    /projects/:id/git/worktrees

POST   /projects/:id/sessions        create worktree + spawn harness
GET    /projects/:id/sessions
GET    /sessions/:id
DELETE /sessions/:id                 stop process + remove worktree
POST   /sessions/:id/messages        { text, requestId }
GET    /sessions/:id/events          SSE stream (attachable anytime)
POST   /sessions/:id/abort
```

### 6.3 Configuration

- Projects root directory (where project folders and worktrees live).
- Pi Durable storage location.
- Server listener address and port.
- Credential encryption key or key source.
- Pi Durable version pin.

## 7. Error Handling and Edge Cases

- **Path traversal**: reject any content request whose resolved path escapes the project root.
- **Duplicate registration**: registering the same absolute path twice must be rejected or resolved deterministically.
- **Non-git folder**: refuse to register a folder that is not a git repository.
- **Missing auth method**: a project with no assigned auth method cannot start sessions; report this clearly.
- **Session crash**: mark the session `crashed`, allow restart, do not lose conversation state or the worktree.
- **Session deletion with uncommitted work**: decide and document whether the worktree is force-removed or preserved. Default to preserving the branch and warning on deletion.
- **Duplicate message submission**: deduplicate by `requestId`.
- **Concurrent session creation**: serialize per project to avoid racing on worktree creation.
- **Unauthorized access**: a user must not be able to read another user's project or its content.

## 8. Testing and Validation

Derive tests from the requirements. At minimum:

- Unit tests for path containment in the content API: traversal attempts must fail.
- Unit tests for credential encryption round-trip.
- Integration tests for project registration and rejection of invalid folders.
- Integration tests for session lifecycle: create session → worktree exists → send message → receive events → delete session → worktree removed.
- Integration test for crash recovery: kill a session process, restart, verify the conversation resumes and history is intact.
- Integration test for exactly-once submission: send the same `requestId` twice, verify only one user message is recorded.
- Integration test for full-history persistence: trigger or simulate a compaction path and verify the mirrored history still contains all original messages.

Run the repository's linter and type checker if present.

## 9. Non-Goals

- No project sharing or collaboration between users in V1.
- No write API for project content in V1 (read-only).
- No web UI, TUI, or CLI client is part of this deliverable.
- No reimplementation of the agent loop, tool execution, or model plumbing. Pi Durable owns that.
- No multi-tenant hardening beyond per-user ownership of projects.
- No speculative features such as project templates, tagging, full-text search, or teams.

## 10. Implementation Guidance

- Use Pi Durable's durable conversation primitive directly. Do not invent a parallel conversation model.
- Enforce isolation structurally: one worktree per session, one process per session. Do not rely on convention alone.
- Keep the server as a supervisor and control plane. It holds metadata and orchestrates processes; it does not hold the agent loop.
- Prefer SQLite for the server's own store unless the repository already has a preferred store.
- Mirror messages as they flow through the session-to-server channel so `MessageMirror` stays in sync.
- Suggested milestones:
  1. Project registry, content API (read-only, path-safe), git status and log. No sessions yet.
  2. One session, hardcoded harness spawn, no worktrees yet. Prove IPC and event streaming.
  3. Worktree-per-session, full lifecycle, deletion, crash recovery.
  4. User and auth method layer, plus per-project auth assignment.

## 11. Definition of Done

- A user can register a git folder as a project, assign an auth method, and list their projects.
- The server exposes read-only project content and git state over HTTP, with path traversal prevented.
- A user can create multiple concurrent sessions in a project. Each has its own worktree and its own harness process, and they do not interfere with each other's edits.
- A user can send prompts to a session and receive events over a stream that can be attached at any time.
- Full message history is persisted independently of Pi Durable compaction.
- Killing and restarting a session process resumes the conversation from the last checkpoint without losing history.
- All tests listed under Testing and Validation pass.
- The repository is left in a working state, with linter and type checker clean.

## 12. Open Questions / Assumptions

Assumptions made where the specification is silent:

- **TypeScript on Bun** is assumed. If the repository already targets a different JS runtime, use that.
- **Exact Pi Durable version** is unspecified. Choose the latest published version at implementation time and record it in the repository.
- **HTTP API user authentication** (login, sessions, tokens) is not specified. A minimal implementation that treats users as principals with credentials issued out-of-band is acceptable; the server must still enforce per-user ownership.
- **IPC mechanism** between server and harness processes is not specified. Unix socket and stdio RPC are both acceptable. Document the choice.
- **Credential encryption scheme** is not specified. Use a standard authenticated encryption with a server-held key.
- **Whether session deletion preserves or removes the branch** is left to the implementer. Default to preserving the branch and warning, since worktrees are the isolation boundary but branches may hold work.
