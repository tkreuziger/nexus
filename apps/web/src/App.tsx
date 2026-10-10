import { ApiError } from "@nexus/client";
import { QueryCache, QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, setToken } from "./api.ts";
import { UserMenu } from "./components/UserMenu.tsx";
import { ProjectLayout } from "./layouts/ProjectLayout.tsx";
import { SettingsLayout } from "./layouts/SettingsLayout.tsx";
import { AuthMethodsPage } from "./pages/AuthMethodsPage.tsx";
import { LoginScreen } from "./pages/LoginScreen.tsx";
import { ProjectFilesPage } from "./pages/ProjectFilesPage.tsx";
import { ProjectGitPage } from "./pages/ProjectGitPage.tsx";
import { ProjectOverviewPage } from "./pages/ProjectOverviewPage.tsx";
import { ProjectSettingsPage } from "./pages/ProjectSettingsPage.tsx";
import { ProjectsPage } from "./pages/ProjectsPage.tsx";
import { SessionsPage } from "./pages/SessionsPage.tsx";
import { SessionViewPage } from "./pages/SessionViewPage.tsx";
import { readToken } from "./token.ts";

const isUnauthorized = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401;

/**
 * The gate: without a token there is nothing to show but the login screen, and with one the app shell
 * renders. A `401` from any query means the stored token is no longer good, so it is dropped and the
 * login screen returns.
 */
export function App(): ReactElement {
  const [token, setTokenState] = useState<string | null>(readToken);
  const signOutRef = useRef<() => void>(() => undefined);

  const signIn = useCallback((next: string) => {
    setToken(next);
    setTokenState(next);
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setTokenState(null);
  }, []);

  useEffect(() => {
    signOutRef.current = signOut;
  }, [signOut]);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            if (isUnauthorized(error)) signOutRef.current();
          },
        }),
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {token === null ? <LoginScreen onSignedIn={signIn} /> : <AppShell onSignOut={signOut} />}
    </QueryClientProvider>
  );
}

function AppShell({ onSignOut }: { onSignOut: () => void }): ReactElement {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const { pathname } = useLocation();
  // The conversation runs its own header, transcript, and composer and scrolls internally, so it
  // takes the viewport instead of the padded column every other page sits in.
  const flush = pathname.startsWith("/sessions/");

  return (
    <div className="app">
      <header className="topbar">
        <Link className="brand" to="/">
          nexus
        </Link>
        <div className="topbar-end">
          <UserMenu
            handle={me.status === "success" ? me.data.user.handle : null}
            onSignOut={onSignOut}
          />
        </div>
      </header>
      <main className={flush ? "main flush" : "main"}>
        <div className={flush ? "page flush" : "page"}>
          <Routes>
            <Route path="/" element={<ProjectsPage />} />
            <Route path="/settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="auth-methods" replace />} />
              <Route path="auth-methods" element={<AuthMethodsPage />} />
            </Route>
            <Route path="/projects/:id" element={<ProjectLayout />}>
              <Route index element={<ProjectOverviewPage />} />
              <Route path="git" element={<ProjectGitPage />} />
              <Route path="files" element={<ProjectFilesPage />} />
              <Route path="sessions" element={<SessionsPage />} />
              <Route path="settings" element={<ProjectSettingsPage />} />
            </Route>
            <Route path="/sessions/:id" element={<SessionViewPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
