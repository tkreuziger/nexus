import type { ListFsResponse } from "@nexus/client";
import { listDirectories } from "../../fs.ts";
import type { RequestScope, Route } from "../contract.ts";
import { boundedInt, jsonResponse } from "../json.ts";

async function list(_scope: RequestScope, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "";
  const limit = boundedInt(url, "limit", 200, 500);
  return jsonResponse<ListFsResponse>(await listDirectories(path, limit));
}

/** Read-only directory listing, used only to autocomplete a path during project registration. */
export const fsRoutes: readonly Route[] = [{ method: "GET", path: "/fs/list", handler: list }];
