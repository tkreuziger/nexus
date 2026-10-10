import type { Database } from "bun:sqlite";
import type { Config } from "../../config.ts";
import { HttpError } from "../../errors.ts";
import { requireProject } from "../../projects/registry.ts";
import type { SessionSupervisor } from "../../sessions/supervisor.ts";
import { listMessages } from "../../store/messages.ts";
import { getProjectById } from "../../store/projects.ts";
import type { ModelRef, ProjectId, Session, SessionId } from "../../types.ts";
import type { RequestScope, Route } from "../contract.ts";
import { boundedInt, optionalString, readJsonObject, requiredString } from "../json.ts";

export interface SessionDeps {
  db: Database;
  config: Config;
  supervisor: SessionSupervisor;
}

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

function modelFrom(body: Record<string, unknown>): ModelRef | undefined {
  const value = body.model;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, '"model" must be an object');
  }
  const record = value as Record<string, unknown>;
  return {
    provider: requiredString(record, "provider"),
    modelId: requiredString(record, "modelId"),
  };
}

/** Resolve a session the caller owns, or throw 404 without revealing that it exists. */
function requireOwnedSession(scope: RequestScope, deps: SessionDeps): Session {
  const id = scope.params.id as SessionId;
  const session = deps.supervisor.get(id);
  const project = session === undefined ? undefined : getProjectById(scope.db, session.projectId);
  if (session === undefined || project === undefined || project.ownerId !== scope.user.id) {
    throw new HttpError(404, `no such session: ${id}`);
  }
  return session;
}

function sseResponse(session: Session, deps: SessionDeps, request: Request): Response {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;
  let detach: (() => void) | undefined;
  const send = (event: unknown) => {
    if (closed || controller === undefined) return;
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  };
  const finish = () => {
    if (closed) return;
    closed = true;
    detach?.();
    controller?.close();
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(created) {
      controller = created;
      const hub = deps.supervisor.hub(session.id);
      if (hub === undefined) {
        finish();
        return;
      }
      const unsubscribeStatus = hub.subscribeStatus(send);
      const subscription = await deps.supervisor.subscribe(session.id, (events) => {
        for (const event of events) send(event);
      });
      detach = () => {
        unsubscribeStatus();
        subscription.release();
      };
      request.signal.addEventListener("abort", finish);
    },
    // The reader cancelling already tears the stream down; closing the controller here is invalid.
    cancel() {
      closed = true;
      detach?.();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}

/** Session lifecycle and conversation routes (§4.2, §6.2). */
export function sessionRoutes(deps: SessionDeps): readonly Route[] {
  return [
    {
      method: "POST",
      path: "/projects/:id/sessions",
      handler: async (scope, request) => {
        const project = requireProject(scope.db, scope.params.id as ProjectId, scope.user.id);
        if (project.assignedAuthMethodId === null) {
          throw new HttpError(
            400,
            "this project has no assigned auth method; assign one before creating sessions",
          );
        }
        const body = await readJsonObject(request);
        const model = modelFrom(body) ?? deps.config.defaultModel;
        if (model === null) {
          throw new HttpError(400, "no model given and NEXUS_DEFAULT_MODEL is not set");
        }
        const session = await deps.supervisor.create(project, {
          name: requiredString(body, "name"),
          model,
          baseRef: optionalString(body, "baseRef") ?? "HEAD",
        });
        return json({ session }, 201);
      },
    },
    {
      method: "GET",
      path: "/projects/:id/sessions",
      handler: (scope) => {
        const project = requireProject(scope.db, scope.params.id as ProjectId, scope.user.id);
        return json({ sessions: deps.supervisor.list(project.id) });
      },
    },
    {
      method: "GET",
      path: "/sessions/:id",
      handler: (scope) => json({ session: requireOwnedSession(scope, deps) }),
    },
    {
      method: "GET",
      path: "/sessions/:id/messages",
      handler: (scope, request) => {
        const session = requireOwnedSession(scope, deps);
        const limit = boundedInt(new URL(request.url), "limit", 1000, 10000);
        return json({ messages: listMessages(scope.db, session.id, limit) });
      },
    },
    {
      method: "POST",
      path: "/sessions/:id/messages",
      handler: async (scope, request) => {
        const session = requireOwnedSession(scope, deps);
        const body = await readJsonObject(request);
        const submissionId = await deps.supervisor.submit(session.id, {
          requestId: requiredString(body, "requestId"),
          text: requiredString(body, "text"),
        });
        return json({ submissionId }, 202);
      },
    },
    {
      method: "POST",
      path: "/sessions/:id/abort",
      handler: async (scope) => {
        const session = requireOwnedSession(scope, deps);
        await deps.supervisor.abort(session.id);
        return json({ aborted: true });
      },
    },
    {
      method: "POST",
      path: "/sessions/:id/restart",
      handler: async (scope) => {
        const session = requireOwnedSession(scope, deps);
        await deps.supervisor.restart(session.id);
        return json({ session: deps.supervisor.get(session.id) });
      },
    },
    {
      method: "DELETE",
      path: "/sessions/:id",
      handler: async (scope, request) => {
        const session = requireOwnedSession(scope, deps);
        const force = new URL(request.url).searchParams.get("force") === "true";
        await deps.supervisor.remove(session.id, { force });
        return json({ deleted: true, preservedBranch: session.branch });
      },
    },
    {
      method: "GET",
      path: "/sessions/:id/events",
      handler: (scope, request) => {
        const session = requireOwnedSession(scope, deps);
        if (deps.supervisor.hub(session.id) === undefined) {
          throw new HttpError(409, "session is not running");
        }
        return sseResponse(session, deps, request);
      },
    },
  ];
}
