import type { WireModelRef } from "@nexus/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { formatTime } from "../format.ts";

/**
 * The default model for new sessions in a project. Provider then model, the same cascade the session
 * dialog uses, and saved as soon as both are chosen. `none` clears it, so a session falls back to the
 * server's `NEXUS_DEFAULT_MODEL`.
 */
function DefaultModelCard({
  projectId,
  defaultModel,
}: {
  projectId: string;
  defaultModel: WireModelRef | null;
}): ReactElement {
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => api.listProviders() });

  const [provider, setProvider] = useState(defaultModel?.provider ?? "");
  const [modelId, setModelId] = useState(defaultModel?.modelId ?? "");

  const models = useQuery({
    queryKey: ["provider-models", provider],
    queryFn: () => api.listProviderModels(provider),
    enabled: provider !== "",
  });

  const save = useMutation({
    mutationFn: (model: WireModelRef | null) => api.assignDefaultModel(projectId, model),
    onSuccess: async (result) => {
      queryClient.setQueryData(["project", projectId], result);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const selectable = (providers.data?.providers ?? []).filter((entry) => entry.modelCount > 0);
  const chosen = (models.data?.models ?? []).find((entry) => entry.id === modelId);

  return (
    <div className="card stack">
      <h2 className="section-title">Default model</h2>
      <p className="muted">
        A new session in this project starts with this model unless the dialog picks another. The
        provider must match the auth method above, since a session only sees that credential.
      </p>

      <label htmlFor="default-model-provider">Provider</label>
      <select
        id="default-model-provider"
        value={provider}
        disabled={providers.isPending || save.isPending}
        onChange={(event) => {
          const next = event.target.value;
          setProvider(next);
          setModelId("");
          if (next === "") save.mutate(null);
        }}
      >
        <option value="">{providers.isPending ? "Loading providers…" : "none"}</option>
        {selectable.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name} ({entry.modelCount})
          </option>
        ))}
      </select>

      {provider === "" ? null : (
        <>
          <label htmlFor="default-model-id">Model</label>
          <select
            id="default-model-id"
            value={modelId}
            disabled={models.isPending || save.isPending}
            onChange={(event) => {
              const next = event.target.value;
              setModelId(next);
              if (next !== "") save.mutate({ provider, modelId: next });
            }}
          >
            <option value="">{models.isPending ? "Loading models…" : "Choose a model"}</option>
            {(models.data?.models ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </>
      )}

      {chosen === undefined ? null : (
        <p className="muted">
          {chosen.contextWindow.toLocaleString()} token context · up to{" "}
          {chosen.maxTokens.toLocaleString()} out
          {chosen.reasoning ? " · reasoning" : ""}
        </p>
      )}
      {models.status === "error" ? (
        <p className="error" role="alert">
          {models.error.message}
        </p>
      ) : null}
      {save.error === null ? null : (
        <p className="error" role="alert">
          {save.error.message}
        </p>
      )}
    </div>
  );
}

export function ProjectSettingsPage(): ReactElement {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();

  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id) });
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => api.listAuthMethods() });

  const assign = useMutation({
    mutationFn: (authMethodId: string | null) => api.assignAuthMethod(id, authMethodId),
    onSuccess: async (result) => {
      queryClient.setQueryData(["project", id], result);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  if (project.status === "pending") return <p className="muted">Loading…</p>;
  if (project.status === "error") {
    return (
      <p className="error" role="alert">
        {project.error.message}
      </p>
    );
  }

  const detail = project.data.project;

  return (
    <section className="stack-lg">
      <h1>Settings</h1>

      <div className="card stack">
        <h2 className="section-title">Auth method</h2>
        {detail.assignedAuthMethodId === null ? (
          <p className="muted">
            None assigned. Sessions cannot start until one is, and a session may only use its
            project's method.
          </p>
        ) : null}
        <label htmlFor="assigned-auth">Assigned to this project</label>
        <select
          id="assigned-auth"
          value={detail.assignedAuthMethodId ?? ""}
          disabled={assign.isPending}
          onChange={(event) => assign.mutate(event.target.value === "" ? null : event.target.value)}
        >
          <option value="">none</option>
          {(methods.data?.authMethods ?? []).map((method) => (
            <option key={method.id} value={method.id}>
              {method.provider} · {method.label} ({method.type})
            </option>
          ))}
        </select>
        {methods.data?.authMethods.length === 0 ? (
          <p className="muted">
            No auth methods exist yet. <Link to="/settings/auth-methods">Add one</Link>.
          </p>
        ) : null}
        {assign.error === null ? null : (
          <p className="error" role="alert">
            {assign.error.message}
          </p>
        )}
      </div>

      <DefaultModelCard projectId={id} defaultModel={detail.defaultModel} />

      <div className="card stack">
        <h2 className="section-title">Project</h2>
        <dl className="facts">
          <dt>Name</dt>
          <dd>{detail.name}</dd>
          <dt>Path</dt>
          <dd className="mono">{detail.path}</dd>
          <dt>Registered</dt>
          <dd>{formatTime(detail.createdAt)}</dd>
        </dl>
        <p className="muted">
          The path is fixed once registered. Sessions are isolated in worktrees outside it, so the
          checkout here stays as you left it.
        </p>
      </div>
    </section>
  );
}
