import type { CreateSessionRequest } from "@nexus/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactElement, useState } from "react";
import { api } from "../api.ts";
import { Modal } from "./Modal.tsx";

/** Create a session on a project. One dialog, opened from wherever a session is relevant. */
export function NewSessionDialog({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [modelId, setModelId] = useState("");
  const [baseRef, setBaseRef] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const providers = useQuery({ queryKey: ["providers"], queryFn: () => api.listProviders() });
  // Only providers with something to choose, so the picker cannot lead to an empty list.
  const selectable = (providers.data?.providers ?? []).filter((entry) => entry.modelCount > 0);
  const modelList = useQuery({
    queryKey: ["provider-models", provider],
    queryFn: () => api.listProviderModels(provider),
    enabled: provider !== "",
  });
  const chosenModel = (modelList.data?.models ?? []).find((entry) => entry.id === modelId);

  const create = useMutation({
    mutationFn: (body: CreateSessionRequest) => api.createSession(projectId, body),
    onSuccess: async () => {
      setName("");
      setProvider("");
      setModelId("");
      setBaseRef("");
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["sessions", projectId] });
      onClose();
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const body: CreateSessionRequest = { name };
    if (provider !== "") {
      if (modelId === "") {
        setFormError("Choose a model, or clear the provider to use the server default.");
        return;
      }
      body.model = { provider, modelId };
    }
    if (baseRef !== "") body.baseRef = baseRef;
    setFormError(null);
    create.mutate(body);
  };

  return (
    <Modal open={open} title="New session" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">
          A session gets its own worktree and its own harness process, so two cannot interfere.
        </p>

        <label htmlFor="new-session-name">Name</label>
        <input
          id="new-session-name"
          value={name}
          placeholder="alpha"
          onChange={(event) => setName(event.target.value)}
          required
        />

        <label htmlFor="new-session-provider">Model provider (optional)</label>
        <select
          id="new-session-provider"
          value={provider}
          disabled={providers.isPending}
          aria-describedby={formError === null ? undefined : "new-session-model-error"}
          onChange={(event) => {
            setProvider(event.target.value);
            setModelId("");
          }}
        >
          <option value="">{providers.isPending ? "Loading providers…" : "Server default"}</option>
          {selectable.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} ({entry.modelCount})
            </option>
          ))}
        </select>

        {provider === "" ? null : (
          <>
            <label htmlFor="new-session-model">Model</label>
            <select
              id="new-session-model"
              value={modelId}
              disabled={modelList.isPending}
              onChange={(event) => setModelId(event.target.value)}
            >
              <option value="">{modelList.isPending ? "Loading models…" : "Choose a model"}</option>
              {(modelList.data?.models ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            {chosenModel === undefined ? null : (
              <p className="muted">
                {chosenModel.contextWindow.toLocaleString()} token context · up to{" "}
                {chosenModel.maxTokens.toLocaleString()} out
                {chosenModel.reasoning ? " · reasoning" : ""} · ${chosenModel.cost.input}/$
                {chosenModel.cost.output} per million tokens
              </p>
            )}
          </>
        )}

        <label htmlFor="new-session-base">Base ref (optional)</label>
        <input
          id="new-session-base"
          value={baseRef}
          placeholder="HEAD"
          onChange={(event) => setBaseRef(event.target.value)}
        />

        {formError === null ? null : (
          <p className="error" id="new-session-model-error" role="alert">
            {formError}
          </p>
        )}
        {create.error === null ? null : (
          <p className="error" role="alert">
            {create.error.message}
          </p>
        )}

        <div className="row">
          <button type="submit" className="button primary" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </button>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
