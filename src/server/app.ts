import type { Database } from "bun:sqlite";
import type { WireError } from "@nexus/client";
import type { Config } from "../config.ts";
import { HttpError } from "../errors.ts";
import type { SessionSupervisor } from "../sessions/supervisor.ts";
import type { Route } from "./contract.ts";
import { resolveUser } from "./principal.ts";
import { matchPath } from "./router.ts";
import { authMethodRoutes } from "./routes/auth-methods.ts";
import { projectRoutes } from "./routes/projects.ts";
import { loginRoutes } from "./routes/session-auth.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { serveWebApp } from "./static.ts";

export interface AppDeps {
  db: Database;
  config: Config;
  supervisor: SessionSupervisor;
  /** Used to seal and open auth-method credentials (ADR-3). */
  secretKey: CryptoKey;
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
): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);
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
    ...projectRoutes,
    ...authMethodRoutes(deps),
    ...sessionRoutes(deps),
  ];
  return async (request) => {
    try {
      const matched = await route(routes, deps, request);
      if (matched !== undefined) return matched;
      // The API is matched first, so the web app can never shadow a route.
      if (deps.config.webDir !== null && request.method === "GET") {
        return await serveWebApp(deps.config.webDir, request);
      }
      const { pathname } = new URL(request.url);
      return errorResponse(404, `no route for ${request.method} ${pathname}`);
    } catch (error) {
      if (error instanceof HttpError) return errorResponse(error.status, error.message);
      console.error("unhandled request error", error);
      return errorResponse(500, "internal server error");
    }
  };
}
