import type { Database } from "bun:sqlite";
import type { Config } from "../config.ts";
import type { User } from "../types.ts";

/** Everything an authenticated route handler needs: the store, configuration, the caller, and path params. */
export interface RequestScope {
  db: Database;
  config: Config;
  user: User;
  params: Record<string, string>;
}

/** The scope a route with `auth: "none"` receives. There is no caller, so there is no user. */
export interface PublicRequestScope {
  db: Database;
  config: Config;
  params: Record<string, string>;
}

export type RouteHandler = (scope: RequestScope, request: Request) => Promise<Response> | Response;

export type PublicRouteHandler = (
  scope: PublicRequestScope,
  request: Request,
) => Promise<Response> | Response;

export type RouteMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface AuthenticatedRoute {
  method: RouteMethod;
  path: string;
  /** Bearer authentication is the default. Only `"none"` opts out. */
  auth?: "required";
  handler: RouteHandler;
}

/**
 * A route that runs without a bearer token. The discriminant is required here, so a handler typed to
 * receive a `user` can never be registered as public by accident.
 */
export interface PublicRoute {
  method: RouteMethod;
  path: string;
  auth: "none";
  handler: PublicRouteHandler;
}

export type Route = AuthenticatedRoute | PublicRoute;
