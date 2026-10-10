import type { Database } from "bun:sqlite";
import type { WireError } from "@nexus/client";
import type { Config } from "../config.ts";
import { HttpError } from "../errors.ts";
import type { SessionSupervisor } from "../sessions/supervisor.ts";
import type { RequestScope, Route } from "./contract.ts";
import { resolveUser } from "./principal.ts";
import { matchPath } from "./router.ts";
import { authMethodRoutes } from "./routes/auth-methods.ts";
import { projectRoutes } from "./routes/projects.ts";
import { sessionRoutes } from "./routes/sessions.ts";

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

async function route(routes: readonly Route[], deps: AppDeps, request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  for (const candidate of routes) {
    if (candidate.method !== request.method) continue;
    const match = matchPath(candidate.path, pathname);
    if (match === undefined) continue;
    const user = await resolveUser(deps.db, request);
    if (user === undefined) return errorResponse(401, "missing or invalid bearer token");
    const scope: RequestScope = { db: deps.db, config: deps.config, user, params: match.params };
    return candidate.handler(scope, request);
  }
  return errorResponse(404, `no route for ${request.method} ${pathname}`);
}

/** Build the request handler: routing, authentication, and the JSON error envelope. */
export function createApp(deps: AppDeps): (request: Request) => Promise<Response> {
  const routes: readonly Route[] = [
    ...projectRoutes,
    ...authMethodRoutes(deps),
    ...sessionRoutes(deps),
  ];
  return async (request) => {
    try {
      return await route(routes, deps, request);
    } catch (error) {
      if (error instanceof HttpError) return errorResponse(error.status, error.message);
      console.error("unhandled request error", error);
      return errorResponse(500, "internal server error");
    }
  };
}
