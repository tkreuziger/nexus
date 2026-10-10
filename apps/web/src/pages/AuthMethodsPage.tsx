import type { WireProvider } from "@nexus/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactElement, useState } from "react";
import { api } from "../api.ts";
import { formatTime } from "../format.ts";

type MethodType = "api_key" | "oauth";

/** The auth label Pi gives a provider for the chosen type, e.g. "Anthropic API key". */
const authNameOf = (provider: WireProvider, type: MethodType): string =>
  (type === "api_key" ? provider.apiKey?.name : provider.oauth?.name) ?? "";

export function AuthMethodsPage(): ReactElement {
  const queryClient = useQueryClient();
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => api.listAuthMethods() });
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => api.listProviders() });

  const [type, setType] = useState<MethodType>("api_key");
  const [provider, setProvider] = useState("");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [refresh, setRefresh] = useState("");
  const [access, setAccess] = useState("");
  const [expires, setExpires] = useState("");

  // Only the providers that accept this kind of auth, so the list cannot offer something that would
  // be refused. Derived rather than reset in an effect: switching type must not leave a stale choice.
  const candidates = (providers.data?.providers ?? []).filter((entry) =>
    type === "api_key" ? entry.apiKey !== null : entry.oauth !== null,
  );
  const selected = candidates.some((entry) => entry.id === provider) ? provider : "";
  const chosen = candidates.find((entry) => entry.id === selected);

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ["auth-methods"] });

  /** Deleting a method clears it from every project using it, so the project views go stale too. */
  const invalidateAfterDelete = async (): Promise<void> => {
    await invalidate();
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    await queryClient.invalidateQueries({ queryKey: ["project"] });
  };

  const create = useMutation({
    mutationFn: () => {
      if (type === "api_key") {
        return label === ""
          ? api.createAuthMethod({ type, provider: selected, key })
          : api.createAuthMethod({ type, provider: selected, label, key });
      }
      const credential = { refresh, access, expires: Number(expires) };
      return label === ""
        ? api.createAuthMethod({ type, provider: selected, credential })
        : api.createAuthMethod({ type, provider: selected, label, credential });
    },
    onSuccess: async () => {
      setProvider("");
      setLabel("");
      setKey("");
      setRefresh("");
      setAccess("");
      setExpires("");
      await invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAuthMethod(id),
    onSuccess: invalidateAfterDelete,
  });

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (selected === "") return;
    create.mutate();
  };

  return (
    <section className="stack-lg">
      <h1>Auth methods</h1>
      <p className="muted">
        A credential is encrypted before storage and never returned — the list below shows metadata
        only. Providers come from Pi, so an unknown one cannot be stored.
      </p>

      <form className="card stack" onSubmit={submit}>
        <h2 className="section-title">Add a method</h2>

        <label htmlFor="method-type">Type</label>
        <select
          id="method-type"
          value={type}
          onChange={(event) => setType(event.target.value === "oauth" ? "oauth" : "api_key")}
        >
          <option value="api_key">API key</option>
          <option value="oauth">OAuth token set</option>
        </select>

        <label htmlFor="method-provider">Provider</label>
        <select
          id="method-provider"
          value={selected}
          disabled={providers.isPending}
          onChange={(event) => setProvider(event.target.value)}
        >
          <option value="">
            {providers.isPending ? "Loading providers…" : "Choose a provider"}
          </option>
          {candidates.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        {providers.status === "error" ? (
          <p className="error" role="alert">
            {providers.error.message}
          </p>
        ) : null}
        {chosen === undefined ? null : (
          <p className="muted">Stored as: {authNameOf(chosen, type)}</p>
        )}
        {candidates.length === 0 && providers.status === "success" ? (
          <p className="muted">No provider offers this kind of auth.</p>
        ) : null}

        <label htmlFor="method-label">Label (optional)</label>
        <input
          id="method-label"
          value={label}
          placeholder="defaults to the provider id"
          onChange={(event) => setLabel(event.target.value)}
        />

        {type === "api_key" ? (
          <>
            <label htmlFor="method-key">Key</label>
            <input
              id="method-key"
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              required
            />
          </>
        ) : (
          <>
            <label htmlFor="method-refresh">Refresh token</label>
            <input
              id="method-refresh"
              value={refresh}
              onChange={(event) => setRefresh(event.target.value)}
              required
            />
            <label htmlFor="method-access">Access token</label>
            <input
              id="method-access"
              value={access}
              onChange={(event) => setAccess(event.target.value)}
              required
            />
            <label htmlFor="method-expires">Expires (epoch milliseconds)</label>
            <input
              id="method-expires"
              type="number"
              value={expires}
              onChange={(event) => setExpires(event.target.value)}
              required
            />
          </>
        )}

        {create.error === null ? null : (
          <p className="error" role="alert">
            {create.error.message}
          </p>
        )}

        <div>
          <button
            type="submit"
            className="button primary"
            disabled={create.isPending || selected === ""}
          >
            {create.isPending ? "Adding…" : "Add"}
          </button>
        </div>
      </form>

      <h2 className="section-title">Stored</h2>
      {methods.status === "pending" ? <p className="muted">Loading…</p> : null}
      {methods.status === "error" ? (
        <p className="error" role="alert">
          {methods.error.message}
        </p>
      ) : null}
      {methods.status === "success" ? (
        methods.data.authMethods.length === 0 ? (
          <p className="muted">No auth methods yet.</p>
        ) : (
          <ul className="list">
            {methods.data.authMethods.map((method) => (
              <li key={method.id} className="card row">
                <div className="grow">
                  <div className="row-title">
                    {method.provider} <span className="muted">· {method.label}</span>
                  </div>
                  <div className="muted">
                    {method.type} · added {formatTime(method.createdAt)}
                    {method.lastUsedAt === null
                      ? " · never used"
                      : ` · last used ${formatTime(method.lastUsedAt)}`}
                  </div>
                </div>
                <button
                  type="button"
                  className="button"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(method.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {remove.error === null ? null : (
        <p className="error" role="alert">
          {remove.error.message}
        </p>
      )}
    </section>
  );
}
