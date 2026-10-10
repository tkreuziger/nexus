import type { LoginResponse, MeResponse } from "@nexus/client";
import { HttpError } from "../../errors.ts";
import { login } from "../../store/users.ts";
import type { Route } from "../contract.ts";
import { jsonResponse, readJsonObject, requiredString } from "../json.ts";

/**
 * Identity routes. `POST /login` is the only route in the server that runs without a bearer token; it
 * exists so a browser can obtain one, since the bootstrap token is otherwise printed once at first boot.
 */
export const loginRoutes: readonly Route[] = [
  {
    method: "POST",
    path: "/login",
    auth: "none",
    handler: async (scope, request) => {
      const body = await readJsonObject(request);
      const result = await login(
        scope.db,
        requiredString(body, "handle"),
        requiredString(body, "secret"),
      );
      if (result === undefined) throw new HttpError(401, "invalid handle or secret");
      return jsonResponse<LoginResponse>(result);
    },
  },
  {
    method: "GET",
    path: "/me",
    handler: (scope) => jsonResponse<MeResponse>({ user: scope.user }),
  },
];
