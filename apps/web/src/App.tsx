import { ApiError } from "@nexus/client";
import { QueryCache, QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { api, setToken } from "./api.ts";
import { AuthMethodsPage } from "./pages/AuthMethodsPage.tsx";
import { LoginScreen } from "./pages/LoginScreen.tsx";
import { ProjectDetailPage } from "./pages/ProjectDetailPage.tsx";
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

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">nexus</span>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>
            Projects
          </NavLink>
          <NavLink to="/auth-methods">Auth methods</NavLink>
        </nav>
        <div className="topbar-end">
          {me.status === "success" ? <span className="muted">{me.data.user.handle}</span> : null}
          <button type="button" className="button ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/projects/:id/sessions" element={<SessionsPage />} />
          <Route path="/sessions/:id" element={<SessionViewPage />} />
          <Route path="/auth-methods" element={<AuthMethodsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
