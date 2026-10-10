/**
 * Every API route lives under this prefix; the web app owns the rest of the URL space (ADR-8).
 *
 * Without the split, a browser navigation to `/projects/<name>` matches the API route
 * `GET /projects/:id` and returns a 401 JSON body instead of the app, because a document load cannot
 * carry a bearer token.
 */
export const API_PREFIX = "/api";
