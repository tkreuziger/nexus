# Project Docs

Documentation index for the Pi Session Server (nexus).

## Plans

- `plans/pi-session-server.md` — implementation plan: verified Pi Durable facts, architecture decisions, repo layout, milestones, and test plan.

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

## Requirements

- `../INPUT.md` — the original specification.
