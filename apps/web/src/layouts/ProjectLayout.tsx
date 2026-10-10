import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { SidebarLayout } from "./SidebarLayout.tsx";

/**
 * The frame for everything scoped to one project: a sidebar of sections and the section itself.
 * The project is loaded here so the sidebar can name it, and every section reuses that cached read.
 */
export function ProjectLayout(): ReactElement {
  const { id = "" } = useParams();
  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id) });
  const base = `/projects/${id}`;
  const name = project.status === "success" ? project.data.project.name : "Project";

  return (
    <SidebarLayout
      header={
        project.status === "success" ? (
          <span className="muted mono sidebar-path">{project.data.project.path}</span>
        ) : undefined
      }
      items={[
        { to: base, label: name, end: true },
        { to: `${base}/git`, label: "Git" },
        { to: `${base}/files`, label: "Files" },
        { to: `${base}/sessions`, label: "Sessions" },
        { to: `${base}/settings`, label: "Settings" },
      ]}
    >
      {project.status === "pending" ? <p className="muted">Loading project…</p> : null}
      {project.status === "error" ? (
        <p className="error" role="alert">
          {project.error.message}
        </p>
      ) : null}
      {project.status === "success" ? <Outlet /> : null}
    </SidebarLayout>
  );
}
