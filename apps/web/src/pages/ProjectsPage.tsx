import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactElement, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.ts";

export function ProjectsPage(): ReactElement {
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.listProjects() });

  const [path, setPath] = useState("");
  const [name, setName] = useState("");

  const register = useMutation({
    mutationFn: () =>
      name === "" ? api.createProject({ path }) : api.createProject({ path, name }),
    onSuccess: async () => {
      setPath("");
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    register.mutate();
  };

  return (
    <section className="stack-lg">
      <h1>Projects</h1>

      <form className="card stack" onSubmit={submit}>
        <h2 className="section-title">Register a project</h2>
        <p className="muted">
          A path to a directory that is already a git repository. Worktrees are created outside it.
        </p>
        <label htmlFor="project-path">Path</label>
        <input
          id="project-path"
          value={path}
          placeholder="/home/you/code/thing"
          aria-describedby={register.error === null ? undefined : "project-path-error"}
          onChange={(event) => setPath(event.target.value)}
          required
        />
        <label htmlFor="project-name">Name (optional)</label>
        <input
          id="project-name"
          value={name}
          placeholder="defaults to the directory name"
          onChange={(event) => setName(event.target.value)}
        />
        {register.error === null ? null : (
          <p className="error" id="project-path-error" role="alert">
            {register.error.message}
          </p>
        )}
        <div>
          <button type="submit" className="button primary" disabled={register.isPending}>
            {register.isPending ? "Registering…" : "Register"}
          </button>
        </div>
      </form>

      <h2 className="section-title">Registered</h2>
      {projects.status === "pending" ? <p className="muted">Loading…</p> : null}
      {projects.status === "error" ? (
        <p className="error" role="alert">
          {projects.error.message}
        </p>
      ) : null}
      {projects.status === "success" ? (
        projects.data.projects.length === 0 ? (
          <p className="muted">Nothing registered yet.</p>
        ) : (
          <ul className="list">
            {projects.data.projects.map((project) => (
              <li key={project.id} className="card row">
                <div className="grow">
                  <Link className="row-title" to={`/projects/${project.id}`}>
                    {project.name}
                  </Link>
                  <div className="muted mono">{project.path}</div>
                </div>
                <span className={project.assignedAuthMethodId === null ? "tag warn" : "tag"}>
                  {project.assignedAuthMethodId === null ? "no auth method" : "ready"}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
