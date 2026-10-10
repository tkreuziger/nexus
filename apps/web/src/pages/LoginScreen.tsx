import { useMutation } from "@tanstack/react-query";
import { type FormEvent, type ReactElement, useState } from "react";
import { api } from "../api.ts";

/** The only user the server creates is `owner`, so it is the sensible default handle. */
export function LoginScreen({ onSignedIn }: { onSignedIn: (token: string) => void }): ReactElement {
  const [handle, setHandle] = useState("owner");
  const [secret, setSecret] = useState("");

  const login = useMutation({
    mutationFn: () => api.login({ handle, secret }),
    onSuccess: (result) => onSignedIn(result.token),
  });

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    login.mutate();
  };

  return (
    <main className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1 className="brand-large">nexus</h1>
        <p className="muted">Sign in with the server user's handle and secret.</p>

        <label htmlFor="handle">Handle</label>
        <input
          id="handle"
          name="handle"
          value={handle}
          autoComplete="username"
          onChange={(event) => setHandle(event.target.value)}
          required
        />

        <label htmlFor="secret">Secret</label>
        <input
          id="secret"
          name="secret"
          type="password"
          value={secret}
          autoComplete="current-password"
          onChange={(event) => setSecret(event.target.value)}
          required
        />

        {login.error === null ? null : (
          <p className="error" role="alert">
            {login.error.message}
          </p>
        )}

        <button type="submit" className="button primary" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
