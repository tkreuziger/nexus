import {
  initialLiveState,
  type MessageRole,
  type MirrorContent,
  mirrorContentOfAssistant,
  parseMirrorContent,
  reduceLiveState,
  type StreamState,
} from "@nexus/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.ts";

const STREAM_LABEL: Record<StreamState, string> = {
  connecting: "connecting…",
  open: "live",
  unavailable: "no process running",
  reconnecting: "reconnecting…",
  closed: "disconnected",
};

function Row({
  messageRole,
  content,
}: {
  messageRole: MessageRole;
  content: MirrorContent;
}): ReactElement {
  if (messageRole === "meta") return <p className="meta-row">{content.text}</p>;
  return (
    <article className={`msg msg-${messageRole}`}>
      <div className="msg-role">
        {messageRole}
        {content.toolName === undefined ? "" : ` · ${content.toolName}`}
      </div>
      {content.thinking === undefined ? null : <pre className="thinking">{content.thinking}</pre>}
      {content.text === "" ? null : <div className="msg-text">{content.text}</div>}
      {content.toolCalls === undefined ? null : (
        <ul className="list">
          {content.toolCalls.map((call) => (
            <li key={call.id} className="mono muted">
              {call.name} {JSON.stringify(call.arguments)}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function SessionViewPage(): ReactElement {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();

  const session = useQuery({
    queryKey: ["session", id],
    queryFn: () => api.getSession(id),
    refetchInterval: 3_000,
  });
  const messages = useQuery({ queryKey: ["messages", id], queryFn: () => api.listMessages(id) });

  const [live, dispatch] = useReducer(reduceLiveState, initialLiveState);
  const [streamState, setStreamState] = useState<StreamState>("closed");

  // The mirror is the authority for committed state; the overlay only covers what is still in flight.
  // The reducer bumps `transcriptVersion` whenever committed state advanced, and that is the signal
  // to refetch — which is what keeps the transcript correct across compaction.
  const versionRef = useRef(0);
  useEffect(() => {
    if (live.transcriptVersion === versionRef.current) return;
    versionRef.current = live.transcriptVersion;
    void queryClient.invalidateQueries({ queryKey: ["messages", id] });
  }, [live.transcriptVersion, id, queryClient]);

  useEffect(() => {
    const stream = api.openStream(id, {
      onFrame: (frame) => dispatch(frame),
      onState: (state) => setStreamState(state),
    });
    stream.start();
    return () => stream.stop();
  }, [id]);

  const [text, setText] = useState("");
  // One id per draft. A send that fails and is retried repeats the id, and the server treats a repeat
  // as a no-op — so a retry cannot deliver the message twice. It only rolls over on success.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const send = useMutation({
    mutationFn: () => api.submitMessage(id, { requestId, text }),
    onSuccess: async () => {
      setText("");
      setRequestId(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ["messages", id] });
    },
  });

  const abort = useMutation({ mutationFn: () => api.abortSession(id) });
  const restart = useMutation({
    mutationFn: () => api.restartSession(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session", id] });
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (text.trim() === "") return;
    send.mutate();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (text.trim() !== "") send.mutate();
    }
  };

  const committed = messages.status === "success" ? messages.data.messages : [];
  const overlay = live.message === null ? null : mirrorContentOfAssistant(live.message);
  // The stream's status is immediate; the polled one can lag a turn by seconds, which is exactly the
  // window in which someone would want to abort.
  const status = live.status ?? (session.status === "success" ? session.data.session.status : null);
  const detached = streamState === "unavailable" || streamState === "closed";

  return (
    <section className="stack-lg">
      <div>
        <p className="muted">
          <Link to={`/projects/${session.data?.session.projectId ?? ""}/sessions`}>← Sessions</Link>
        </p>
        <div className="row">
          <h1 className="grow">{session.data?.session.name ?? "Session"}</h1>
          <span className="muted mono">{STREAM_LABEL[streamState]}</span>
        </div>
        {session.status === "success" ? (
          <p className="muted mono">
            {session.data.session.branch} · {status ?? session.data.session.status} ·{" "}
            {session.data.session.model.provider}:{session.data.session.model.modelId}
          </p>
        ) : null}
      </div>

      {detached ? (
        <div className="notice">
          <p className="muted">
            {streamState === "unavailable"
              ? "This session has no running process, so there is nothing to attach to. The transcript below is still complete."
              : "The event stream is disconnected."}
          </p>
          <div>
            <button
              type="button"
              className="button"
              disabled={restart.isPending}
              onClick={() => restart.mutate()}
            >
              {restart.isPending ? "Restarting…" : "Start the process"}
            </button>
          </div>
        </div>
      ) : null}

      {live.compactions.length > 0 ? <p className="meta-row">compacting context…</p> : null}
      {live.notice === null ? null : <p className="meta-row">{live.notice.text}</p>}
      {live.failures.map((failure) => (
        <p key={`${failure.kind}:${failure.message}`} className="error" role="alert">
          {failure.kind}: {failure.message}
        </p>
      ))}

      <div className="transcript">
        {messages.status === "pending" ? <p className="muted">Loading transcript…</p> : null}
        {messages.status === "error" ? (
          <p className="error" role="alert">
            {messages.error.message}
          </p>
        ) : null}
        {committed.map((row) => (
          <Row key={row.entryId} messageRole={row.role} content={parseMirrorContent(row.content)} />
        ))}
        {overlay === null ? null : <Row messageRole="assistant" content={overlay} />}
        {committed.length === 0 && overlay === null && messages.status === "success" ? (
          <p className="muted">Nothing has been said yet.</p>
        ) : null}
      </div>

      {live.tools.length === 0 ? null : (
        <div className="stack">
          {live.tools.map((tool) =>
            tool.status === "running" ? (
              <div key={tool.callId} className="card stack tool">
                <div className="row">
                  <span className="mono grow">{tool.name}</span>
                  <span className="tag live">running</span>
                </div>
                {tool.args === null ? null : (
                  <pre className="code">{JSON.stringify(tool.args, null, 2)}</pre>
                )}
                {tool.output === "" ? null : <pre className="code">{tool.output}</pre>}
              </div>
            ) : (
              <details key={tool.callId} className="card tool">
                <summary className="mono">
                  {tool.name} <span className="muted">· done</span>
                </summary>
                {tool.args === null ? null : (
                  <pre className="code">{JSON.stringify(tool.args, null, 2)}</pre>
                )}
                {tool.output === "" ? null : <pre className="code">{tool.output}</pre>}
              </details>
            ),
          )}
        </div>
      )}

      <form className="card stack composer" onSubmit={submit}>
        <label htmlFor="prompt">Prompt</label>
        <textarea
          id="prompt"
          value={text}
          rows={3}
          placeholder="Ask the agent to do something in its worktree"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {send.error === null ? null : (
          <p className="error" role="alert">
            {send.error.message}
          </p>
        )}
        <div className="row">
          <button
            type="submit"
            className="button primary"
            disabled={send.isPending || text.trim() === ""}
          >
            {send.isPending ? "Sending…" : "Send"}
          </button>
          {status === "running" ? (
            <button
              type="button"
              className="button"
              disabled={abort.isPending}
              onClick={() => abort.mutate()}
            >
              Abort
            </button>
          ) : null}
          <span className="muted grow">⌘/Ctrl + Enter</span>
        </div>
        {live.inbox.length === 0 ? null : (
          <p className="muted">{live.inbox.length} queued behind the running turn.</p>
        )}
      </form>

      {live.usage === null ? null : (
        <p className="muted mono">
          {Object.entries(live.usage.models)
            .map(([model, totals]) => `${model}: ${totals.input} in / ${totals.output} out`)
            .join(" · ")}
        </p>
      )}
    </section>
  );
}
