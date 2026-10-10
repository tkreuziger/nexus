import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { api } from "../api.ts";

export function ProjectsPage(): ReactElement {
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.listProjects() });

  if (projects.status === "pending") return <p className="muted">Loading projects…</p>;
  if (projects.status === "error") {
    return (
      <p className="error" role="alert">
        {projects.error.message}
      </p>
    );
  }

  const { projects: items } = projects.data;

  return (
    <section>
      <h1>Projects</h1>
      {items.length === 0 ? (
        <p className="muted">No projects are registered yet.</p>
      ) : (
        <ul className="list">
          {items.map((project) => (
            <li key={project.id} className="card row">
              <div>
                <div className="row-title">{project.name}</div>
                <div className="muted mono">{project.path}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
