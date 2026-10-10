import { type ReactElement, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

/**
 * The account control in the top bar: an avatar showing the handle's initial, and a small menu behind
 * it. Settings and sign-out live here rather than as loose top-bar entries, and the menu is where the
 * next account action goes.
 *
 * It is a menu, not a dialog: it closes on the item that was used, on Escape, and on a click outside.
 */
export function UserMenu({
  handle,
  onSignOut,
}: {
  handle: string | null;
  onSignOut: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initial = handle === null || handle === "" ? "?" : handle.charAt(0).toUpperCase();

  return (
    <div className="user-menu" ref={containerRef}>
      <button
        type="button"
        className="avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        title={handle ?? undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">{initial}</span>
      </button>
      {open ? (
        <div className="menu" role="menu">
          <NavLink
            to="/settings"
            role="menuitem"
            className="menu-item"
            onClick={() => setOpen(false)}
          >
            Settings
          </NavLink>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
