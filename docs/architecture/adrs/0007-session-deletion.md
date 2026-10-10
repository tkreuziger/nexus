# ADR-7: Deleting a session preserves its branch

`INPUT.md` §7 requires a decision on session deletion with uncommitted work, defaulting to preserving the branch and warning.

## Context

A session's isolation boundary is its worktree (`pi/<sessionName>`); the branch may hold commits the user has not merged.

## Decision

`DELETE /sessions/:id` stops the harness process, removes the worktree, and deletes the session's own records — the session row, its mirrored transcript, its request-dedup rows, and its Pi Durable storage file. It never deletes the branch. The response reports `preservedBranch: true` and names it. Removal uses `git worktree remove` without `--force` unless the caller passes `?force=true`, so a dirty worktree is refused with 409 rather than silently discarded.

The session's *code* survives on the branch; its *conversation* does not. That is deliberate: delete means delete, and the transcript mirror exists to render a live session, not to archive a finished one.

## Consequences

- Work committed on the session branch is never lost by a delete.
- A dirty worktree fails the delete and tells the user why, instead of discarding uncommitted edits.
- Branches accumulate; pruning them is the user's decision, not the server's.
- The forced path exists but is opt-in and explicit.
- Deleting a session is irreversible for its transcript; there is no soft-delete in V1.

## Related

- `docs/plans/pi-session-server.md` — ADR-7
- `INPUT.md` §7 — session deletion with uncommitted work
