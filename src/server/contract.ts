import type { Database } from "bun:sqlite";
import type { Config } from "../config.ts";
import type { User } from "../types.ts";

/** Everything a route handler needs: the store, configuration, the authenticated user, and path params. */
export interface RequestScope {
  db: Database;
  config: Config;
  user: User;
  params: Record<string, string>;
}

export type RouteHandler = (scope: RequestScope, request: Request) => Promise<Response> | Response;

export interface Route {
  method: "GET" | "POST" | "DELETE";
  path: string;
  handler: RouteHandler;
}
