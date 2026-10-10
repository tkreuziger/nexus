import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { api } from "../api.ts";

/**
 * The frame for everything scoped to one project: a sidebar of sections and the section itself.
 * The project is loaded here so the sidebar can name it, and every section reuses that cached read.
 */
export function ProjectLayout(): ReactElement {
  const { id = "" } = useParams();
  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id) });
  const base = `/projects/${id}`;

  return (
    <div className="project">
      <aside className="sidebar">
        <div className="sidebar-head">
          <Link className="sidebar-title" to="/">
            ← {project.status === "success" ? project.data.project.name : "Project"}
          </Link>
          {project.status === "success" ? (
            <div className="muted mono sidebar-path">{project.data.project.path}</div>
          ) : null}
        </div>
        <nav className="sidebar-nav" aria-label="Project sections">
          <NavLink to={base} end>
            Overview
          </NavLink>
          <NavLink to={`${base}/git`}>Git</NavLink>
          <NavLink to={`${base}/files`}>Files</NavLink>
          <NavLink to={`${base}/sessions`}>Sessions</NavLink>
          <NavLink to={`${base}/settings`}>Settings</NavLink>
        </nav>
      </aside>
      <div className="project-body">
        {project.status === "pending" ? <p className="muted">Loading project…</p> : null}
        {project.status === "error" ? (
          <p className="error" role="alert">
            {project.error.message}
          </p>
        ) : null}
        {project.status === "success" ? <Outlet /> : null}
      </div>
    </div>
  );
}
