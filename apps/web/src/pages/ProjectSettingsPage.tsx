import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { formatTime } from "../format.ts";

export function ProjectSettingsPage(): ReactElement {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();

  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id) });
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => api.listAuthMethods() });

  const assign = useMutation({
    mutationFn: (authMethodId: string | null) => api.assignAuthMethod(id, authMethodId),
    onSuccess: async (result) => {
      queryClient.setQueryData(["project", id], result);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  if (project.status === "pending") return <p className="muted">Loading…</p>;
  if (project.status === "error") {
    return (
      <p className="error" role="alert">
        {project.error.message}
      </p>
    );
  }

  const detail = project.data.project;

  return (
    <section className="stack-lg">
      <h1>Settings</h1>

      <div className="card stack">
        <h2 className="section-title">Auth method</h2>
        {detail.assignedAuthMethodId === null ? (
          <p className="muted">
            None assigned. Sessions cannot start until one is, and a session may only use its
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
        <h2 className="section-title">Project</h2>
        <dl className="facts">
          <dt>Name</dt>
          <dd>{detail.name}</dd>
          <dt>Path</dt>
          <dd className="mono">{detail.path}</dd>
          <dt>Registered</dt>
          <dd>{formatTime(detail.createdAt)}</dd>
        </dl>
        <p className="muted">
          The path is fixed once registered. Sessions are isolated in worktrees outside it, so the
          checkout here stays as you left it.
        </p>
      </div>
    </section>
  );
}
