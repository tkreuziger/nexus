import type { Database } from "bun:sqlite";
import type { WireError } from "@nexus/client";
import type { ModelCatalog } from "../catalog.ts";
import type { Config } from "../config.ts";
import { HttpError } from "../errors.ts";
import type { SessionSupervisor } from "../sessions/supervisor.ts";
import type { Route } from "./contract.ts";
import { resolveUser } from "./principal.ts";
import { matchPath } from "./router.ts";
import { authMethodRoutes } from "./routes/auth-methods.ts";
import { fsRoutes } from "./routes/fs.ts";
import { projectRoutes } from "./routes/projects.ts";
import { providerRoutes } from "./routes/providers.ts";
import { loginRoutes } from "./routes/session-auth.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { serveWebApp } from "./static.ts";

/**
 * Every API route lives under this prefix, so the web app can own the rest of the URL space. Without
 * the split, a browser navigation to `/projects/<name>` matches `GET /projects/:id` and returns a 401
 * JSON body instead of the app, because a document load cannot carry a bearer token.
 */
export const API_PREFIX = "/api";

export interface AppDeps {
  db: Database;
  config: Config;
  supervisor: SessionSupervisor;
  /** Used to seal and open auth-method credentials (ADR-3). */
  secretKey: CryptoKey;
  /** The providers and models Pi knows, used to validate what a request names. */
  catalog: ModelCatalog;
}

const errorResponse = (status: number, message: string) =>
  Response.json({ error: { message } } satisfies WireError, {
    status,
    headers: { "cache-control": "no-store" },
  });

/** Match a route and run it, or return `undefined` when no route matches this method and path. */
async function route(
  routes: readonly Route[],
  deps: AppDeps,
  request: Request,
  pathname: string,
): Promise<Response | undefined> {
  for (const candidate of routes) {
    if (candidate.method !== request.method) continue;
    const match = matchPath(candidate.path, pathname);
    if (match === undefined) continue;
    const base = { db: deps.db, config: deps.config, params: match.params };
    if (candidate.auth === "none") return candidate.handler(base, request);
    const user = await resolveUser(deps.db, request);
    if (user === undefined) return errorResponse(401, "missing or invalid bearer token");
    return candidate.handler({ ...base, user }, request);
  }
  return undefined;
}

/** Build the request handler: routing, authentication, the SPA fallback, and the JSON error envelope. */
export function createApp(deps: AppDeps): (request: Request) => Promise<Response> {
  const routes: readonly Route[] = [
    ...loginRoutes,
    ...providerRoutes(deps),
    ...fsRoutes,
    ...projectRoutes,
    ...authMethodRoutes(deps),
    ...sessionRoutes(deps),
  ];
  return async (request) => {
    try {
      const { pathname } = new URL(request.url);
      if (pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)) {
        const relative = pathname.slice(API_PREFIX.length) || "/";
        const matched = await route(routes, deps, request, relative);
        return matched ?? errorResponse(404, `no route for ${request.method} ${pathname}`);
      }
      // Outside the API prefix the web app owns the URL space.
      if (deps.config.webDir !== null && request.method === "GET") {
        return await serveWebApp(deps.config.webDir, request);
      }
      return errorResponse(404, `no route for ${request.method} ${pathname}`);
    } catch (error) {
      if (error instanceof HttpError) return errorResponse(error.status, error.message);
      console.error("unhandled request error", error);
      return errorResponse(500, "internal server error");
    }
  };
}
