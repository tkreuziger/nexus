import { useQuery } from "@tanstack/react-query";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { api } from "../api.ts";

/**
 * The frame for everything scoped to one project: a sidebar of sections and the section itself.
 * The project is loaded here so the sidebar can name it, and every section reuses that cached read.
 *
 * A phone cannot spare a 190px column for navigation, so below the drawer width the sidebar leaves
 * the grid and slides in over the section, opened by the hamburger in the project bar. It is a menu
 * rather than a dialog: it closes on the link that was used, on Escape and on the scrim behind it.
 */
export function ProjectLayout(): ReactElement {
  const { id = "" } = useParams();
  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id) });
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const base = `/projects/${id}`;
  const name = project.status === "success" ? project.data.project.name : "Project";

  const close = useCallback((): void => {
    setOpen(false);
    // The drawer's links are inside it, so closing from one would otherwise leave focus off-canvas.
    toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  return (
    <div className="project">
      <div className="project-bar">
        <button
          ref={toggleRef}
          type="button"
          className="button sidebar-toggle"
          aria-expanded={open}
          aria-controls="project-sections"
          onClick={() => (open ? close() : setOpen(true))}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M2 4h12M2 8h12M2 12h12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          Sections
        </button>
      </div>
      <aside id="project-sections" className="sidebar" data-open={open}>
        {project.status === "success" ? (
          <div className="muted mono sidebar-path">{project.data.project.path}</div>
        ) : null}
        <nav className="sidebar-nav" aria-label="Project sections">
          <NavLink to={base} end onClick={close}>
            {name}
          </NavLink>
          <NavLink to={`${base}/git`} onClick={close}>
            Git
          </NavLink>
          <NavLink to={`${base}/files`} onClick={close}>
            Files
          </NavLink>
          <NavLink to={`${base}/sessions`} onClick={close}>
            Sessions
          </NavLink>
          <NavLink to={`${base}/settings`} onClick={close}>
            Settings
          </NavLink>
        </nav>
      </aside>
      {open ? (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="Close sections"
          onClick={close}
        />
      ) : null}
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
