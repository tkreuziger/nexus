import { useQuery } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { NewSessionDialog } from "../components/NewSessionDialog.tsx";
import { isActive, SESSION_STATUS_CLASS } from "../status.ts";

export function ProjectOverviewPage(): ReactElement {
  const { id = "" } = useParams();
  const [creating, setCreating] = useState(false);

  // The layout already read the project, so this is the same cached entry rather than a second call.
  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id) });
  const sessions = useQuery({
    queryKey: ["sessions", id],
    queryFn: () => api.listSessions(id),
    // A session's status changes on its own, so the overview follows it without a refresh.
    refetchInterval: 3_000,
  });
  const status = useQuery({
    queryKey: ["project", id, "git", "status"],
    queryFn: () => api.getGitStatus(id),
  });

  const all = sessions.data?.sessions ?? [];
  const running = all.filter((session) => isActive(session.status));
  const resting = all.length - running.length;

  return (
    <section className="stack-lg">
      <div className="row">
        <h1 className="grow">
          {project.status === "success" ? project.data.project.name : "Project"}
        </h1>
        <button type="button" className="button primary" onClick={() => setCreating(true)}>
          New session
        </button>
      </div>

      <div className="card stack">
        <div className="row">
          <h2 className="section-title grow">Active sessions</h2>
          <Link to={`/projects/${id}/sessions`}>All sessions →</Link>
        </div>

        {sessions.status === "pending" ? <p className="muted">Loading…</p> : null}
        {sessions.status === "error" ? (
          <p className="error" role="alert">
            {sessions.error.message}
          </p>
        ) : null}
        {sessions.status === "success" ? (
          running.length === 0 ? (
            <p className="muted">
              Nothing is running.
              {resting === 0 ? "" : ` ${resting} stopped or crashed.`}
            </p>
          ) : (
            <ul className="list">
              {running.map((session) => (
                <li key={session.id} className="row">
                  <Link className="grow" to={`/sessions/${session.id}`}>
                    {session.name}
                  </Link>
                  <span className="muted mono">
                    {session.model.provider}:{session.model.modelId}
                  </span>
                  <span className={SESSION_STATUS_CLASS[session.status]}>{session.status}</span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      <div className="card stack">
        <div className="row">
          <h2 className="section-title grow">Git status</h2>
          <Link to={`/projects/${id}/git`}>Details →</Link>
        </div>

        {status.status === "pending" ? <p className="muted">Loading…</p> : null}
        {status.status === "error" ? (
          <p className="error" role="alert">
            {status.error.message}
          </p>
        ) : null}
        {status.status === "success" ? (
          <>
            <p>
              <span className="mono">{status.data.status.branch}</span>
              <span className="muted">
                {" "}
                · {status.data.status.ahead} ahead · {status.data.status.behind} behind
              </span>
            </p>
            {status.data.status.dirty.length === 0 ? (
              <p className="muted">Working tree clean.</p>
            ) : (
              <p className="muted">
                {status.data.status.dirty.length} uncommitted{" "}
                {status.data.status.dirty.length === 1 ? "change" : "changes"} ·{" "}
                <span className="mono">{status.data.status.dirty.slice(0, 3).join(", ")}</span>
                {status.data.status.dirty.length > 3 ? " …" : ""}
              </p>
            )}
          </>
        ) : null}
      </div>

      <NewSessionDialog projectId={id} open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}
