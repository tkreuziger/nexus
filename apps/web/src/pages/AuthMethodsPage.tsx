import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactElement, useState } from "react";
import { api } from "../api.ts";
import { formatTime } from "../format.ts";

type MethodType = "api_key" | "oauth";

export function AuthMethodsPage(): ReactElement {
  const queryClient = useQueryClient();
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => api.listAuthMethods() });

  const [type, setType] = useState<MethodType>("api_key");
  const [provider, setProvider] = useState("");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [refresh, setRefresh] = useState("");
  const [access, setAccess] = useState("");
  const [expires, setExpires] = useState("");

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
          ? api.createAuthMethod({ type, provider, key })
          : api.createAuthMethod({ type, provider, label, key });
      }
      const credential = { refresh, access, expires: Number(expires) };
      return label === ""
        ? api.createAuthMethod({ type, provider, credential })
        : api.createAuthMethod({ type, provider, label, credential });
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
    create.mutate();
  };

  return (
    <section className="stack-lg">
      <h1>Auth methods</h1>
      <p className="muted">
        A credential is encrypted before storage and never returned — the list below shows metadata
        only.
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
        <input
          id="method-provider"
          value={provider}
          placeholder="anthropic"
          onChange={(event) => setProvider(event.target.value)}
          required
        />

        <label htmlFor="method-label">Label (optional)</label>
        <input
          id="method-label"
          value={label}
          placeholder="defaults to the provider"
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
          <button type="submit" className="button primary" disabled={create.isPending}>
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
