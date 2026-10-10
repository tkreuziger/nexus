import { THINKING_LEVELS, type ThinkingLevel, type WireModelRef } from "@nexus/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactElement, useEffect, useState } from "react";
import { api } from "../api.ts";
import { Modal } from "./Modal.tsx";

/** A plain-language gloss per level, so the choice does not need Pi's vocabulary. */
const THINKING_SUMMARY: Record<ThinkingLevel, string> = {
  off: "answer without deliberating",
  minimal: "the least thinking the model offers",
  low: "a little deliberation",
  medium: "balanced",
  high: "more deliberation before answering",
  xhigh: "a lot of deliberation",
  max: "as much as the model will do",
};

/**
 * A session's model and reasoning effort.
 *
 * The same provider-then-model cascade the create dialog uses, seeded from what the session is
 * already running with rather than from a default, since this edits rather than chooses.
 */
export function SessionSettingsDialog({
  sessionId,
  model,
  thinkingLevel,
  open,
  onClose,
}: {
  sessionId: string;
  model: WireModelRef;
  thinkingLevel: ThinkingLevel;
  open: boolean;
  onClose: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState(model.provider);
  const [modelId, setModelId] = useState(model.modelId);
  const [level, setLevel] = useState<ThinkingLevel>(thinkingLevel);
  const [formError, setFormError] = useState<string | null>(null);

  // Re-seed on open, so a cancelled edit does not linger into the next visit.
  useEffect(() => {
    if (!open) return;
    setProvider(model.provider);
    setModelId(model.modelId);
    setLevel(thinkingLevel);
    setFormError(null);
  }, [open, model.provider, model.modelId, thinkingLevel]);

  const providers = useQuery({ queryKey: ["providers"], queryFn: () => api.listProviders() });
  const selectable = (providers.data?.providers ?? []).filter((entry) => entry.modelCount > 0);
  const modelList = useQuery({
    queryKey: ["provider-models", provider],
    queryFn: () => api.listProviderModels(provider),
    enabled: provider !== "",
  });
  const chosen = (modelList.data?.models ?? []).find((entry) => entry.id === modelId);

  const save = useMutation({
    mutationFn: () =>
      api.configureSession(sessionId, { model: { provider, modelId }, thinkingLevel: level }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      onClose();
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (provider === "" || modelId === "") {
      setFormError("Choose a provider and a model.");
      return;
    }
    setFormError(null);
    save.mutate();
  };

  return (
    <Modal open={open} title="Session settings" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">
          Applies from the next turn. An answer already being written is not interrupted.
        </p>

        <label htmlFor="session-provider">Model provider</label>
        <select
          id="session-provider"
          value={provider}
          disabled={providers.isPending}
          aria-describedby={formError === null ? undefined : "session-settings-error"}
          onChange={(event) => {
            setProvider(event.target.value);
            setModelId("");
          }}
        >
          <option value="">
            {providers.isPending ? "Loading providers…" : "Choose a provider"}
          </option>
          {selectable.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} ({entry.modelCount})
            </option>
          ))}
        </select>

        <label htmlFor="session-model">Model</label>
        <select
          id="session-model"
          value={modelId}
          disabled={modelList.isPending || provider === ""}
          onChange={(event) => setModelId(event.target.value)}
        >
          <option value="">{modelList.isPending ? "Loading models…" : "Choose a model"}</option>
          {(modelList.data?.models ?? []).map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        {chosen === undefined ? null : (
          <p className="muted">
            {chosen.contextWindow.toLocaleString()} token context · up to{" "}
            {chosen.maxTokens.toLocaleString()} out
            {chosen.reasoning ? " · reasoning" : ""}
          </p>
        )}

        <label htmlFor="session-thinking">Thinking</label>
        <select
          id="session-thinking"
          value={level}
          onChange={(event) => {
            const next = THINKING_LEVELS.find((candidate) => candidate === event.target.value);
            if (next !== undefined) setLevel(next);
          }}
        >
          {THINKING_LEVELS.map((entry) => (
            <option key={entry} value={entry}>
              {entry} — {THINKING_SUMMARY[entry]}
            </option>
          ))}
        </select>

        {formError === null ? null : (
          <p className="error" id="session-settings-error" role="alert">
            {formError}
          </p>
        )}
        {save.error === null ? null : (
          <p className="error" role="alert">
            {save.error.message}
          </p>
        )}

        <div className="row">
          <button type="submit" className="button primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
