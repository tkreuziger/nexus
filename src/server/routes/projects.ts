import type {
  ContentResponse,
  CreateProjectResponse,
  GitLogResponse,
  GitStatusResponse,
  GitWorktreesResponse,
  ListProjectsResponse,
  ProjectResponse,
  SearchResponse,
} from "@nexus/client";
import { HttpError } from "../../errors.ts";
import { readProjectContent } from "../../projects/content.ts";
import { gitLog, gitStatus, gitWorktrees } from "../../projects/git.ts";
import { registerProject, requireProject } from "../../projects/registry.ts";
import { searchProject } from "../../projects/search.ts";
import { listProjects } from "../../store/projects.ts";
import type { Project, ProjectId } from "../../types.ts";
import type { RequestScope, Route } from "../contract.ts";
import {
  boundedInt,
  jsonResponse,
  optionalString,
  readJsonObject,
  requiredString,
} from "../json.ts";

const projectId = (scope: RequestScope): ProjectId => scope.params.id as ProjectId;

const owned = (scope: RequestScope): Project =>
  requireProject(scope.db, projectId(scope), scope.user.id);

const list = (scope: RequestScope): Response =>
  jsonResponse<ListProjectsResponse>({ projects: listProjects(scope.db, scope.user.id) });

async function register(scope: RequestScope, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  const project = await registerProject(scope.db, scope.user.id, {
    path: requiredString(body, "path"),
    name: optionalString(body, "name"),
  });
  return jsonResponse<CreateProjectResponse>({ project }, 201);
}

const get = (scope: RequestScope): Response =>
  jsonResponse<ProjectResponse>({ project: owned(scope) });

async function content(scope: RequestScope, request: Request): Promise<Response> {
  const project = owned(scope);
  const requested = new URL(request.url).searchParams.get("path") ?? "";
  return jsonResponse<ContentResponse>({
    content: await readProjectContent(project.path, requested),
  });
}

async function search(scope: RequestScope, request: Request): Promise<Response> {
  const project = owned(scope);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  if (query === "") throw new HttpError(400, '"q" must be a non-empty string');
  const limit = boundedInt(url, "limit", 100, 500);
  return jsonResponse<SearchResponse>({
    ...(await searchProject(project.path, query, limit)),
  });
}

async function status(scope: RequestScope): Promise<Response> {
  return jsonResponse<GitStatusResponse>({ status: await gitStatus(owned(scope).path) });
}

async function log(scope: RequestScope, request: Request): Promise<Response> {
  const limit = boundedInt(new URL(request.url), "limit", 20, 200);
  return jsonResponse<GitLogResponse>({ commits: await gitLog(owned(scope).path, limit) });
}

async function worktrees(scope: RequestScope): Promise<Response> {
  return jsonResponse<GitWorktreesResponse>({ worktrees: await gitWorktrees(owned(scope).path) });
}

/** Read-only project routes: registration, metadata, content, and git state (§6.2). */
export const projectRoutes: readonly Route[] = [
  { method: "POST", path: "/projects", handler: register },
  { method: "GET", path: "/projects", handler: list },
  { method: "GET", path: "/projects/:id", handler: get },
  { method: "GET", path: "/projects/:id/content", handler: content },
  { method: "GET", path: "/projects/:id/search", handler: search },
  { method: "GET", path: "/projects/:id/git/status", handler: status },
  { method: "GET", path: "/projects/:id/git/log", handler: log },
  { method: "GET", path: "/projects/:id/git/worktrees", handler: worktrees },
];
