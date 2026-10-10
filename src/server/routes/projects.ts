import type {
  ContentResponse,
  CreateProjectResponse,
  GitLogResponse,
  GitStatusResponse,
  GitWorktreesResponse,
  ListProjectsResponse,
  ProjectResponse,
} from "@nexus/client";
import type { ModelCatalog } from "../../catalog.ts";
import { HttpError } from "../../errors.ts";
import { readProjectContent } from "../../projects/content.ts";
import { gitLog, gitStatus, gitWorktrees } from "../../projects/git.ts";
import { registerProject, requireProject } from "../../projects/registry.ts";
import { listProjects, setProjectDefaultModel } from "../../store/projects.ts";
import type { ModelRef, Project, ProjectId } from "../../types.ts";
import type { RequestScope, Route } from "../contract.ts";
import {
  boundedInt,
  jsonResponse,
  optionalString,
  readJsonObject,
  requiredString,
} from "../json.ts";

export interface ProjectDeps {
  catalog: ModelCatalog;
}

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

/** Read `{ model }` as a model reference, where `null` means "no default". */
function modelFrom(body: Record<string, unknown>): ModelRef | null {
  const value = body.model;
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, '"model" must be an object or null');
  }
  const record = value as Record<string, unknown>;
  return {
    provider: requiredString(record, "provider"),
    modelId: requiredString(record, "modelId"),
  };
}

async function setDefaultModel(
  scope: RequestScope,
  request: Request,
  deps: ProjectDeps,
): Promise<Response> {
  const project = owned(scope);
  const model = modelFrom(await readJsonObject(request));
  // The catalogue is the same one a harness resolves against, so an unknown model is refused here
  // rather than becoming a session that fails on its first request.
  if (model !== null) {
    if ((await deps.catalog.provider(model.provider)) === undefined) {
      throw new HttpError(400, `unknown provider "${model.provider}"`);
    }
    if ((await deps.catalog.model(model.provider, model.modelId)) === undefined) {
      throw new HttpError(400, `provider "${model.provider}" has no model "${model.modelId}"`);
    }
  }
  setProjectDefaultModel(scope.db, project.id, model);
  return jsonResponse<ProjectResponse>({ project: owned(scope) });
}

/** Read-only project routes plus the two project settings: registration, metadata, content, git, model. */
export function projectRoutes(deps: ProjectDeps): readonly Route[] {
  return [
    { method: "POST", path: "/projects", handler: register },
    { method: "GET", path: "/projects", handler: list },
    { method: "GET", path: "/projects/:id", handler: get },
    { method: "GET", path: "/projects/:id/content", handler: content },
    { method: "GET", path: "/projects/:id/git/status", handler: status },
    { method: "GET", path: "/projects/:id/git/log", handler: log },
    { method: "GET", path: "/projects/:id/git/worktrees", handler: worktrees },
    {
      method: "PUT",
      path: "/projects/:id/default-model",
      handler: (scope, request) => setDefaultModel(scope, request, deps),
    },
  ];
}
