import { ApiClient } from "@nexus/client";
import { readToken, writeToken } from "./token.ts";

/**
 * The client's default base URL is the server's API prefix, so one value works everywhere: in
 * development Vite proxies `/api` to the server, and in production the server serves both.
 */
export const api = new ApiClient({ token: readToken() });

/** Store the token for later visits and point the client at it. */
export function setToken(token: string | null): void {
  writeToken(token);
  api.setToken(token);
}
