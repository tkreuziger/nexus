# ADR-5: Users authenticate with out-of-band bearer tokens

`INPUT.md` §12 leaves HTTP user authentication unspecified and permits "users as principals with credentials issued out-of-band", while still requiring per-user ownership enforcement.

## Context

The user layer is deliberately minimal (§3.1). The server must never expose another user's project, content, or git state.

## Decision

Each user holds a bearer token of the form `nx_<tokenId>_<secret>`. The `tokenId` selects the row, so lookup is one indexed read; only the secret's argon2id hash (`Bun.password`) is stored. Requests carry `Authorization: Bearer <token>`; `src/server/principal.ts` resolves it to a user, and every project query is owner-scoped in SQL (`getProject` filters on `owner_id`), so another user's project is a 404 rather than a 403.

## Consequences

- A leaked database yields no usable tokens.
- Argon2 verification happens once per request, not per candidate user, because the token id narrows the row first.
- Tokens do not expire and there is no revocation endpoint in V1; rotation means reissuing.
- Returning 404 for another user's project avoids confirming its existence.
- TLS is not terminated by this server; a token is only as safe as the transport in front of it.

## Related

- `docs/plans/pi-session-server.md` — ADR-5
- `src/server/principal.ts`, `src/store/users.ts`
