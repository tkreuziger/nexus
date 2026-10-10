import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.ts";
import { CommitList } from "../components/CommitList.tsx";
import { formatTime } from "../format.ts";

export function ProjectGitPage(): ReactElement {
  const { id = "" } = useParams();

  const status = useQuery({
    queryKey: ["project", id, "git", "status"],
    queryFn: () => api.getGitStatus(id),
  });
  const worktrees = useQuery({
    queryKey: ["project", id, "git", "worktrees"],
    queryFn: () => api.getGitWorktrees(id),
  });
  const log = useQuery({
    queryKey: ["project", id, "git", "log"],
    queryFn: () => api.getGitLog(id, 20),
  });

  return (
    <section className="stack-lg">
      <h1>Git</h1>

      <div className="card stack">
        <h2 className="section-title">Status</h2>
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
              <ul className="list">
                {status.data.status.dirty.map((path) => (
                  <li key={path} className="mono">
                    {path}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>

      <div className="card stack">
        <h2 className="section-title">Worktrees</h2>
        <p className="muted">
          One per session, created outside the checkout so tools that walk the repository stay
          clean.
        </p>
        {worktrees.status === "pending" ? <p className="muted">Loading…</p> : null}
        {worktrees.status === "error" ? (
          <p className="error" role="alert">
            {worktrees.error.message}
          </p>
        ) : null}
        {worktrees.status === "success" ? (
          <ul className="list">
            {worktrees.data.worktrees.map((tree) => (
              <li key={tree.path}>
                <div className="mono">{tree.path}</div>
                <div className="muted">
                  {tree.branch ?? (tree.detached ? "detached" : "—")}
                  {tree.head === null ? "" : ` · ${tree.head.slice(0, 8)}`}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="card stack">
        <h2 className="section-title">History</h2>
        {log.status === "pending" ? <p className="muted">Loading…</p> : null}
        {log.status === "error" ? (
          <p className="error" role="alert">
            {log.error.message}
          </p>
        ) : null}
        {log.status === "success" ? <CommitList commits={log.data.commits} /> : null}
      </div>

      <p className="muted">Fetched {formatTime(new Date().toISOString())}</p>
    </section>
  );
}
