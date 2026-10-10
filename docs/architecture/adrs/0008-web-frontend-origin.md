# ADR-8: The web app shares the server's origin and logs in with a bearer token

A browser frontend needs to call the API, and the server was built for a single authenticated client with no browser-facing surface at all.

## Context

Three facts constrain the options:

- The server sets no CORS headers and handles no `OPTIONS` preflight. Any cross-origin call from a dev server would fail.
- `EventSource` cannot set an `Authorization` header, so the standard SSE client cannot authenticate against the event stream.
- The only credential is a bearer token printed once at first boot. A browser has no way to obtain one.

## Decision

**The API lives under `/api`; the web app owns every other path.** API routes are matched first within the prefix, and outside it the app is served from `NEXUS_WEB_DIR` with an `index.html` fallback so client-side routes deep-link.

The prefix is not cosmetic. A browser navigation to `/projects/<name>` matches the API route `GET /projects/:id`, and a document load cannot carry an `Authorization` header, so without the split a deep link returned `401 {"error":…}` instead of the app. Keeping the two in separate URL spaces makes the collision impossible rather than merely unlikely.

**Authentication is a bearer token obtained from `POST /login`**, which verifies a handle and secret against the stored argon2id hash and reconstructs `nx_<tokenId>_<secret>`. The browser keeps the token in `localStorage` and sends it on every request.

**The event stream is read with `fetch` and a `ReadableStream` reader**, not `EventSource`, because only `fetch` can send the `Authorization` header.

## Consequences

- No CORS allowlist, no preflight handling, no cookie, and no CSRF surface. The auth model stays a plain header everywhere, including on the stream.
- `POST /login` is the only route that runs without a bearer token. The route table carries an explicit `auth: "none"` discriminant, and a handler typed to receive a `user` cannot be registered as public by accident.
- A secret containing `_` is refused at user creation, because `authenticate` splits a token on `_` and requires exactly three parts.
- `localStorage` is readable by any script on the origin. Acceptable for a test harness; a cookie session is the upgrade path if this becomes a product.
- Deploying the app on a different origin later would require CORS headers or a reverse proxy. Neither exists today.

## Alternatives rejected

- **CORS headers on the server.** Widens the attack surface and needs preflight handling, for no gain over same-origin serving.
- **A cookie session.** Solves the SSE-header problem too, but adds CSRF considerations and a server-side session store.
- **Passing the token as a query parameter on the stream.** Puts a credential in URLs, and therefore in logs and referrers.

## Related

- `docs/plans/web-frontend.md` — the frontend plan
- `src/server/routes/session-auth.ts`, `src/server/static.ts`, `packages/client/src/stream.ts`
