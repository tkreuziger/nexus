# ADR-1: Inter-process transport is newline-delimited JSON over stdio

The server spawns one harness process per session and must exchange requests, responses, and event notifications with it.

## Context

`INPUT.md` §5.2 permits a Unix socket or stdio RPC and requires the choice to be documented. The harness process is ours to write (Pi Durable ships no binary), so the transport is a free choice. `src/sessions/ipc.ts` and `src/harness/protocol.ts` implement it.

## Decision

Parent writes one JSON request per line to the child's `stdin`; the child writes one JSON response or notification per line to `stdout`. Requests are `{ id, method, params }`; notifications omit `id`. All child logging goes to `stderr`, so `stdout` carries protocol frames only.

## Consequences

- Child death is observable as process exit, so crash detection needs no heartbeat.
- No socket path, no stale-socket cleanup after a crash, no port allocation.
- The pipe is scoped to the session by construction; nothing else can attach.
- Backpressure is inherited from the pipe, so a stalled parent blocks the child's writes.
- Debugging requires a tool that frames lines; raw `stderr` output stays readable.

## Related

- `docs/plans/pi-session-server.md` — IPC protocol surface
- `docs/architecture/pi-durable-api.md` — why a harness process must exist
