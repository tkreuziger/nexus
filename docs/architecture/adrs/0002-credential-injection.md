# ADR-2: Credentials reach the harness through a proxy `CredentialStore`

When a session process starts, it needs the project's assigned auth method — an API key or an OAuth token set — and OAuth tokens must be refreshed as they expire.

## Context

`INPUT.md` §5.4 permits environment variables or the `Models` collection and requires the choice to be documented. `createModels({ credentials })` accepts a `CredentialStore`, and Pi performs OAuth refresh *inside* `CredentialStore.modify` (`docs/architecture/pi-durable-api.md`).

## Decision

The server passes only `authMethodId` and `provider` at `init`. The harness implements `CredentialStore` and proxies `read`/`list`/`modify`/`delete` to the server over IPC; the server decrypts on read and re-encrypts on `modify`.

## Consequences

- Plaintext credentials exist only in the harness process's memory; the server keeps ciphertext at rest.
- Rotated OAuth refresh tokens persist automatically, because the refresh write flows back through `modify`.
- Credentials survive a harness restart without re-plumbing environment variables.
- Auth resolution costs one IPC round trip; it is not on the per-token path, so this is acceptable.
- The harness cannot start a model request while the server is unreachable.

## Alternatives rejected

- **Environment variables at spawn:** no write-back path, so a rotated refresh token is lost and the session breaks at the next expiry.
- **Server decrypts and passes the credential inline at `init`:** same loss on rotation, plus plaintext in the spawn arguments.

## Related

- `docs/plans/pi-session-server.md` — ADR-2
- `docs/architecture/pi-durable-api.md` — credential surface
