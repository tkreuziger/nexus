# ADR-7: Deleting a session preserves its branch

`INPUT.md` §7 requires a decision on session deletion with uncommitted work, defaulting to preserving the branch and warning.

## Context

A session's isolation boundary is its worktree (`pi/<sessionName>`); the branch may hold commits the user has not merged.

## Decision

`DELETE /sessions/:id` stops the harness process and removes the worktree, but never deletes the branch. The response reports `preservedBranch: true` and names it. Removal uses `git worktree remove` without `--force` unless the caller explicitly passes `force=true`, so a dirty worktree is refused rather than silently discarded.

## Consequences

- Work committed on the session branch is never lost by a delete.
- A dirty worktree fails the delete and tells the user why, instead of discarding uncommitted edits.
- Branches accumulate; pruning them is the user's decision, not the server's.
- The forced path exists but is opt-in and explicit.

## Related

- `docs/plans/pi-session-server.md` — ADR-7
- `INPUT.md` §7 — session deletion with uncommitted work
