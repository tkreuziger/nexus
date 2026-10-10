# Project Docs

Documentation index for the Pi Session Server (nexus).

## Start here

- `../README.md` — what the server does, configuration, the HTTP API, the IPC protocol, credentials, worktree layout, the deletion policy, and how the host runs it.
- `../deploy/` — the systemd unit and the Apache vhost pair as installed on this host: state dirs, loopback port, TLS, and the proxy options the event stream needs.

## Plans

- `plans/pi-session-server.md` — implementation plan: verified Pi Durable facts, architecture decisions, repo layout, milestones, and test plan. Complete.
- `plans/web-frontend.md` — browser frontend plan: workspace layout, the shared `@nexus/client` contract, the mirror-versus-stream rendering model, the server changes it needs, and milestones W0–W6.

## Architecture

- `architecture/pi-durable-api.md` — the `@earendil-works/pi-durable@1.1.0` calls this project depends on, verified by execution on Bun.

### Decision records

- `architecture/adrs/0001-ipc-transport.md` — newline-delimited JSON over stdio between server and harness.
- `architecture/adrs/0002-credential-injection.md` — proxy `CredentialStore` so OAuth refresh persists.
- `architecture/adrs/0003-credential-encryption.md` — AES-256-GCM under a server-held 0600 key file.
- `architecture/adrs/0004-storage.md` — SQLite on both sides; `bun:sqlite` facade for Pi's portable core.
- `architecture/adrs/0005-user-authentication.md` — out-of-band bearer tokens, owner-scoped queries.
- `architecture/adrs/0006-model-selection.md` — per-session model with `NEXUS_DEFAULT_MODEL` fallback.
- `architecture/adrs/0007-session-deletion.md` — deletion removes the worktree and preserves the branch.
- `architecture/adrs/0008-web-frontend-origin.md` — the web app shares the API's origin; login issues a bearer token; the stream is read with `fetch`.
- `architecture/adrs/0009-markdown-and-highlighting.md` — messages render as sanitized markdown; code is highlighted by highlight.js.
- `architecture/adrs/0010-skills.md` — skills are Pi's, discovered by the client package's loader and advertised through a registry prompt section.

## Requirements

- `../INPUT.md` — the original specification.
