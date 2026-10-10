import { type ReactElement, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

export interface SidebarItem {
  to: string;
  label: string;
  /** Match the path exactly, for an index route whose prefix every sibling shares. */
  end?: boolean;
}

/**
 * A frame of navigation beside a section: a sidebar of links, the section itself, and the optional
 * header that names what the links belong to (a project's path, or "Settings").
 *
 * A phone cannot spare a 190px column for navigation, so below the drawer width the sidebar leaves
 * the grid and slides in over the section, opened by the hamburger in the bar. It is a menu rather
 * than a dialog: it closes on the link that was used, on Escape and on the scrim behind it.
 */
export function SidebarLayout({
  header,
  items,
  children,
}: {
  header?: ReactNode;
  items: readonly SidebarItem[];
  children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

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
          aria-controls="sidebar-sections"
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
      <aside id="sidebar-sections" className="sidebar" data-open={open}>
        {header === undefined ? null : <div className="sidebar-header">{header}</div>}
        <nav className="sidebar-nav" aria-label="Sections">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end === true} onClick={close}>
              {item.label}
            </NavLink>
          ))}
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
      <div className="project-body">{children}</div>
    </div>
  );
}
