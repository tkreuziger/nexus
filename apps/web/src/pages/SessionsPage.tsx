import { ApiError } from "@nexus/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { NewSessionDialog } from "../components/NewSessionDialog.tsx";
import { SESSION_STATUS_CLASS } from "../status.ts";

export function SessionsPage(): ReactElement {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();

  const sessions = useQuery({
    queryKey: ["sessions", id],
    queryFn: () => api.listSessions(id),
    // Status changes on its own — a harness starts, crashes, or goes idle without any UI action.
    refetchInterval: 2_000,
  });
  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id) });

  const [creating, setCreating] = useState(false);
  const [confirmForce, setConfirmForce] = useState<string | null>(null);

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ["sessions", id] });

  const restart = useMutation({
    mutationFn: (sessionId: string) => api.restartSession(sessionId),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: ({ sessionId, force }: { sessionId: string; force: boolean }) =>
      api.deleteSession(sessionId, force ? { force: true } : {}),
    onSuccess: async () => {
      setConfirmForce(null);
      await invalidate();
    },
    onError: (error, variables) => {
      // 409 means the worktree holds uncommitted work; ask before discarding it.
      if (error instanceof ApiError && error.status === 409) setConfirmForce(variables.sessionId);
    },
  });

  const unassigned =
    project.status === "success" && project.data.project.assignedAuthMethodId === null;

  return (
    <section className="stack-lg">
      <div className="row">
        <h1 className="grow">Sessions</h1>
        <button type="button" className="button primary" onClick={() => setCreating(true)}>
          New session
        </button>
      </div>

      {unassigned ? (
        <p className="error" role="alert">
          This project has no assigned auth method, so sessions cannot start.{" "}
          <Link to={`/projects/${id}/settings`}>Assign one</Link>.
        </p>
      ) : null}

      {sessions.status === "pending" ? <p className="muted">Loading…</p> : null}
      {sessions.status === "error" ? (
        <p className="error" role="alert">
          {sessions.error.message}
        </p>
      ) : null}
      {sessions.status === "success" ? (
        sessions.data.sessions.length === 0 ? (
          <p className="muted">No sessions yet.</p>
        ) : (
          <ul className="list">
            {sessions.data.sessions.map((session) => (
              <li key={session.id} className="card stack">
                <div className="row">
                  <span className="row-title grow">{session.name}</span>
                  <span className={SESSION_STATUS_CLASS[session.status]}>{session.status}</span>
                </div>
                <dl className="facts">
                  <dt>Branch</dt>
                  <dd className="mono">{session.branch}</dd>
                  <dt>Base</dt>
                  <dd className="mono">{session.baseRef}</dd>
                  <dt>Model</dt>
                  <dd className="mono">
                    {session.model.provider}:{session.model.modelId}
                  </dd>
                  <dt>Process</dt>
                  <dd className="mono">{session.pid === null ? "—" : session.pid}</dd>
                  <dt>Worktree</dt>
                  <dd className="mono">{session.worktreePath}</dd>
                </dl>

                {confirmForce === session.id ? (
                  <div className="notice">
                    <p className="error" role="alert">
                      The worktree holds uncommitted work. Deleting discards it. The branch is kept.
                    </p>
                    <div className="row">
                      <button
                        type="button"
                        className="button danger"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate({ sessionId: session.id, force: true })}
                      >
                        Discard and delete
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={() => setConfirmForce(null)}
                      >
                        Keep it
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="row">
                    <Link className="button" to={`/sessions/${session.id}`}>
                      Open
                    </Link>
                    <button
                      type="button"
                      className="button"
                      disabled={restart.isPending}
                      onClick={() => restart.mutate(session.id)}
                    >
                      Restart
                    </button>
                    <button
                      type="button"
                      className="button danger"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate({ sessionId: session.id, force: false })}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )
      ) : null}
      {remove.error !== null && confirmForce === null ? (
        <p className="error" role="alert">
          {remove.error.message}
        </p>
      ) : null}

      <NewSessionDialog projectId={id} open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}
