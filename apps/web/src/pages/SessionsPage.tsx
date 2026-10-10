import type { CreateSessionRequest } from "@nexus/client";
import { ApiError } from "@nexus/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactElement, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.ts";

const STATUS_CLASS: Record<string, string> = {
  running: "tag live",
  idle: "tag ok",
  crashed: "tag bad",
  stopped: "tag",
  starting: "tag",
};

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

  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [baseRef, setBaseRef] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmForce, setConfirmForce] = useState<string | null>(null);

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ["sessions", id] });

  const create = useMutation({
    mutationFn: (body: CreateSessionRequest) => api.createSession(id, body),
    onSuccess: async () => {
      setName("");
      setModel("");
      setBaseRef("");
      setFormError(null);
      await invalidate();
    },
  });

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

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const body: CreateSessionRequest = { name };
    if (model !== "") {
      const separator = model.indexOf(":");
      if (separator <= 0 || separator === model.length - 1) {
        setFormError('Model must be "provider:modelId".');
        return;
      }
      body.model = { provider: model.slice(0, separator), modelId: model.slice(separator + 1) };
    }
    if (baseRef !== "") body.baseRef = baseRef;
    setFormError(null);
    create.mutate(body);
  };

  const unassigned =
    project.status === "success" && project.data.project.assignedAuthMethodId === null;

  return (
    <section className="stack-lg">
      <div>
        <p className="muted">
          <Link to={`/projects/${id}`}>
            ← {project.status === "success" ? project.data.project.name : "Project"}
          </Link>
        </p>
        <h1>Sessions</h1>
        <p className="muted">
          Each session gets its own worktree and its own harness process, so two sessions on one
          project cannot interfere.
        </p>
      </div>

      {unassigned ? (
        <p className="error" role="alert">
          This project has no assigned auth method, so sessions cannot start.{" "}
          <Link to={`/projects/${id}`}>Assign one</Link>.
        </p>
      ) : null}

      <form className="card stack" onSubmit={submit}>
        <h2 className="section-title">Create a session</h2>
        <label htmlFor="session-name">Name</label>
        <input
          id="session-name"
          value={name}
          placeholder="alpha"
          onChange={(event) => setName(event.target.value)}
          required
        />
        <label htmlFor="session-model">Model (optional)</label>
        <input
          id="session-model"
          value={model}
          placeholder="provider:modelId — defaults to NEXUS_DEFAULT_MODEL"
          aria-describedby={formError === null ? undefined : "session-model-error"}
          onChange={(event) => setModel(event.target.value)}
        />
        <label htmlFor="session-base">Base ref (optional)</label>
        <input
          id="session-base"
          value={baseRef}
          placeholder="HEAD"
          onChange={(event) => setBaseRef(event.target.value)}
        />
        {formError === null ? null : (
          <p className="error" id="session-model-error" role="alert">
            {formError}
          </p>
        )}
        {create.error === null ? null : (
          <p className="error" role="alert">
            {create.error.message}
          </p>
        )}
        <div>
          <button type="submit" className="button primary" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </form>

      <div>
        <h2 className="section-title">Existing</h2>
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
                    <span className={STATUS_CLASS[session.status] ?? "tag"}>{session.status}</span>
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
                        The worktree holds uncommitted work. Deleting discards it. The branch is
                        kept.
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
      </div>
    </section>
  );
}
