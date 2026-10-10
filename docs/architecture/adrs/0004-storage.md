# ADR-4: SQLite on both sides, with a `bun:sqlite` facade for the portable core

The server needs its own metadata store; each session needs a Pi Durable store. `INPUT.md` §3.3 prefers SQLite for both.

## Context

Pi Durable's documented Node path (`openNodeSqliteStorage`) depends on `node:sqlite`, which **Bun 1.3.14 does not implement** — `error: No such built-in module: node:sqlite`. Its portable core (`@earendil-works/pi-durable/storage/sqlite`) runs on Bun given a `SqliteDatabase` facade. Pi Durable also states one process owns a storage at a time, with no cross-process locking.

## Decision

- Server store: `bun:sqlite` directly, opened by `src/store/db.ts` with WAL and `synchronous=NORMAL`.
- Session stores: Pi Durable's portable `SqliteStorage` over a `bun:sqlite` `SqliteDatabase` facade (`src/harness/bun-sqlite.ts`), which serializes operations through a promise chain and rolls back on callback rejection.
- The two are always separate files owned by separate processes. The server never opens a session's Pi Durable store.

## Consequences

- No dependency on `node:sqlite`; the stack runs on Bun today.
- Exclusive ownership means no cross-process locking is needed, and no lock contention exists by construction.
- The facade must preserve Pi Durable's transaction contract: unrelated operations queue behind a transaction, and a rejected callback rolls back before rethrowing.
- If Bun later implements `node:sqlite`, the facade remains the Bun path and can be deleted only if it becomes redundant.

## Related

- `docs/plans/pi-session-server.md` — ADR-4
- `docs/architecture/pi-durable-api.md` — storage verification
