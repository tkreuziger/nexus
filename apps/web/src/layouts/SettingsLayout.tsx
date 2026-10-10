import type { ReactElement } from "react";
import { Outlet } from "react-router-dom";
import { SidebarLayout } from "./SidebarLayout.tsx";

/**
 * Account settings: a sidebar of sections so the next one (profile, tokens, …) is a link rather than
 * another top-level page. Auth methods moved here from the main navigation.
 */
export function SettingsLayout(): ReactElement {
  return (
    <SidebarLayout
      header={<span className="sidebar-title">Settings</span>}
      items={[{ to: "/settings/auth-methods", label: "Auth methods" }]}
    >
      <Outlet />
    </SidebarLayout>
  );
}
