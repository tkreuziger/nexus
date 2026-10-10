import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { FileBrowser } from "../components/FileBrowser.tsx";
import { formatTime } from "../format.ts";

export function ProjectDetailPage(): ReactElement {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();

  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id) });
  const status = useQuery({
    queryKey: ["project", id, "git", "status"],
    queryFn: () => api.getGitStatus(id),
  });
  const log = useQuery({
    queryKey: ["project", id, "git", "log"],
    queryFn: () => api.getGitLog(id, 20),
  });
  const worktrees = useQuery({
    queryKey: ["project", id, "git", "worktrees"],
    queryFn: () => api.getGitWorktrees(id),
  });
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => api.listAuthMethods() });

  const assign = useMutation({
    mutationFn: (authMethodId: string | null) => api.assignAuthMethod(id, authMethodId),
    onSuccess: async (result) => {
      queryClient.setQueryData(["project", id], result);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  if (project.status === "pending") return <p className="muted">Loading project…</p>;
  if (project.status === "error") {
    return (
      <p className="error" role="alert">
        {project.error.message}
      </p>
    );
  }

  const { project: detail } = project.data;

  return (
    <section className="stack-lg">
      <div>
        <p className="muted">
          <Link to="/">← Projects</Link>
        </p>
        <h1>{detail.name}</h1>
        <p className="muted mono">{detail.path}</p>
        <p>
          <Link to={`/projects/${id}/sessions`}>Sessions →</Link>
        </p>
      </div>

      <div className="card stack">
        <h2 className="section-title">Auth method</h2>
        {detail.assignedAuthMethodId === null ? (
          <p className="muted">
            None assigned. Sessions cannot start until one is, and each session may only use its
            project's method.
          </p>
        ) : null}
        <label htmlFor="assigned-auth">Assigned to this project</label>
        <select
          id="assigned-auth"
          value={detail.assignedAuthMethodId ?? ""}
          disabled={assign.isPending}
          onChange={(event) => assign.mutate(event.target.value === "" ? null : event.target.value)}
        >
          <option value="">none</option>
          {(methods.data?.authMethods ?? []).map((method) => (
            <option key={method.id} value={method.id}>
              {method.provider} · {method.label} ({method.type})
            </option>
          ))}
        </select>
        {methods.data?.authMethods.length === 0 ? (
          <p className="muted">
            No auth methods exist yet. <Link to="/auth-methods">Add one</Link>.
          </p>
        ) : null}
        {assign.error === null ? null : (
          <p className="error" role="alert">
            {assign.error.message}
          </p>
        )}
      </div>

      <div className="card stack">
        <h2 className="section-title">Git status</h2>
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
        <h2 className="section-title">Recent commits</h2>
        {log.status === "pending" ? <p className="muted">Loading…</p> : null}
        {log.status === "error" ? (
          <p className="error" role="alert">
            {log.error.message}
          </p>
        ) : null}
        {log.status === "success" ? (
          <ul className="list">
            {log.data.commits.map((commit) => (
              <li key={commit.sha} className="row">
                <span className="mono muted">{commit.sha.slice(0, 8)}</span>
                <span className="grow">{commit.subject}</span>
                <span className="muted">{commit.author}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="card stack">
        <h2 className="section-title">Worktrees</h2>
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

      <FileBrowser projectId={id} />

      <p className="muted">Registered {formatTime(detail.createdAt)}</p>
    </section>
  );
}
