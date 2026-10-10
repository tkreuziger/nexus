import { useQuery } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import { NewProjectDialog } from "../components/NewProjectDialog.tsx";

export function ProjectsPage(): ReactElement {
  const [registering, setRegistering] = useState(false);
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.listProjects() });

  return (
    <section className="stack-lg">
      <div className="row">
        <h1 className="grow">Projects</h1>
        <button type="button" className="button primary" onClick={() => setRegistering(true)}>
          Register project
        </button>
      </div>

      {projects.status === "pending" ? <p className="muted">Loading…</p> : null}
      {projects.status === "error" ? (
        <p className="error" role="alert">
          {projects.error.message}
        </p>
      ) : null}
      {projects.status === "success" ? (
        projects.data.projects.length === 0 ? (
          <p className="muted">
            Nothing registered yet. A project is a directory that is already a git repository.
          </p>
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
                <span className={project.assignedAuthMethodId === null ? "tag warn" : "tag ok"}>
                  {project.assignedAuthMethodId === null ? "no auth method" : "ready"}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <NewProjectDialog open={registering} onClose={() => setRegistering(false)} />
    </section>
  );
}
