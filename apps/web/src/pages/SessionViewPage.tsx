import {
  initialLiveState,
  type LiveState,
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
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { CodeBlock } from "../components/CodeBlock.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { Modal } from "../components/Modal.tsx";

const STREAM_LABEL: Record<StreamState, string> = {
  connecting: "connecting…",
  open: "live",
  unavailable: "no process running",
  reconnecting: "reconnecting…",
  closed: "disconnected",
};

/**
 * Token totals for the header, summed across the session's models.
 *
 * The model name is not part of this: the header already names it, and ADR-6 pins one model per
 * session, so a per-model breakdown would repeat the line above for no gain.
 */
function formatUsage(usage: LiveState["usage"]): string | null {
  if (usage === null) return null;
  let input = 0;
  let output = 0;
  for (const totals of Object.values(usage.models)) {
    input += totals.input;
    output += totals.output;
  }
  return `${input.toLocaleString()} in / ${output.toLocaleString()} out`;
}

/** The maximize glyph for the prompt's pop-out control. */
function MaximizeIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

/**
 * How to send, as key caps rather than spelled-out words. Shown where a keyboard is present; a touch
 * screen gets the Send button instead (see `.send-touch`).
 */
function SendHint(): ReactElement {
  return (
    <span className="muted grow send-hint">
      <kbd>⌘</kbd>
      <span>/</span>
      <kbd>Ctrl</kbd>
      <span>+</span>
      <kbd>⏎</kbd>
      <span>to send prompt</span>
    </span>
  );
}

function Row({
  messageRole,
  content,
}: {
  messageRole: MessageRole;
  content: MirrorContent;
}): ReactElement {
  if (messageRole === "meta") return <p className="meta-row">{content.text}</p>;
  // A tool result is the bulkiest thing a transcript holds — whole files and command output — so it
  // is folded behind its name and only opened on request.
  if (messageRole === "tool") {
    const label = content.toolName ?? "tool";
    const lines = content.text === "" ? 0 : content.text.split("\n").length;
    return (
      <details className="msg msg-tool">
        <summary className="tool-summary">
          <span className="mono">{label}</span>
          <span className="muted">
            {" · "}
            {lines === 0 ? "no output" : `${lines} ${lines === 1 ? "line" : "lines"}`}
          </span>
        </summary>
        {content.text === "" ? null : (
          <div className="tool-output">
            <CodeBlock text={content.text} />
          </div>
        )}
      </details>
    );
  }
  return (
    <article className={`msg msg-${messageRole}`}>
      <div className="msg-role">
        {messageRole}
        {content.toolName === undefined ? "" : ` · ${content.toolName}`}
      </div>
      {content.thinking === undefined ? null : <pre className="thinking">{content.thinking}</pre>}
      {content.text === "" ? null : messageRole === "assistant" ? (
        <Markdown text={content.text} />
      ) : (
        <div className="msg-text">{content.text}</div>
      )}
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

  // The transcript scrolls on its own, so the header and composer stay put. `stick` tracks whether
  // the reader is at the bottom: if they are, new content keeps them there; if they have scrolled up
  // to read, the view is left alone and the jump button appears instead.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const onScroll = (): void => {
    const element = scrollRef.current;
    if (element === null) return;
    const near = element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
    stickRef.current = near;
    setAtBottom(near);
  };

  const jumpToBottom = (): void => {
    const element = scrollRef.current;
    if (element === null) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  };

  // Runs before paint so a streamed token never shows the transcript a frame behind.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null || !stickRef.current) return;
    element.scrollTop = element.scrollHeight;
  });

  // The composer grows with its draft up to a fifth of the viewport and then scrolls. CSS carries the
  // same cap, so a window resize cannot leave a stale pixel height behind.
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const element = composerRef.current;
    if (element === null) return;
    element.style.height = "auto";
    const border = element.offsetHeight - element.clientHeight;
    element.style.height = `${element.scrollHeight + border}px`;
  });

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

  const sendPrompt = (): void => {
    if (text.trim() === "") return;
    // Sending is an explicit request to follow the answer, even from partway up the transcript.
    stickRef.current = true;
    // The pop-out is for writing, so sending closes it and hands the reader back to the answer.
    setExpanded(false);
    send.mutate();
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    sendPrompt();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendPrompt();
    }
  };

  const committed = messages.status === "success" ? messages.data.messages : [];
  const overlay = live.message === null ? null : mirrorContentOfAssistant(live.message);
  // The stream's status is immediate; the polled one can lag a turn by seconds, which is exactly the
  // window in which someone would want to abort.
  const status = live.status ?? (session.status === "success" ? session.data.session.status : null);
  const detached = streamState === "unavailable" || streamState === "closed";

  // The header names the model once; the branch is `pi/<name>` by construction, so repeating it there
  // would print the session's name a second time.
  const meta: string[] = [];
  if (session.status === "success") {
    meta.push(status ?? session.data.session.status);
    meta.push(`${session.data.session.model.provider}:${session.data.session.model.modelId}`);
  }
  const usageText = formatUsage(live.usage);
  if (usageText !== null) meta.push(usageText);

  return (
    <section className="chat">
      <header className="chat-head">
        <div className="chat-col chat-head-col">
          <p className="chat-back">
            <Link to={`/projects/${session.data?.session.projectId ?? ""}/sessions`}>
              ← Sessions
            </Link>
          </p>
          <div className="row">
            <h1 className="grow chat-title">{session.data?.session.name ?? "Session"}</h1>
            {streamState === "open" ? null : (
              <span className="muted mono">{STREAM_LABEL[streamState]}</span>
            )}
          </div>
          {meta.length === 0 ? null : <p className="muted mono chat-meta">{meta.join(" · ")}</p>}
          {live.compactions.length > 0 ? <p className="meta-row">compacting context…</p> : null}
          {live.notice === null ? null : <p className="meta-row">{live.notice.text}</p>}
          {live.failures.map((failure) => (
            <p key={`${failure.kind}:${failure.message}`} className="error" role="alert">
              {failure.kind}: {failure.message}
            </p>
          ))}
          {detached ? (
            <div className="notice chat-notice">
              <p className="muted grow">
                {streamState === "unavailable"
                  ? "This session has no running process, so there is nothing to attach to. The transcript below is still complete."
                  : "The event stream is disconnected."}
              </p>
              <button
                type="button"
                className="button"
                disabled={restart.isPending}
                onClick={() => restart.mutate()}
              >
                {restart.isPending ? "Restarting…" : "Start the process"}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-col chat-transcript">
          {messages.status === "pending" ? <p className="muted">Loading transcript…</p> : null}
          {messages.status === "error" ? (
            <p className="error" role="alert">
              {messages.error.message}
            </p>
          ) : null}
          {committed.map((row) => (
            <Row
              key={row.entryId}
              messageRole={row.role}
              content={parseMirrorContent(row.content)}
            />
          ))}
          {overlay === null ? null : <Row messageRole="assistant" content={overlay} />}
          {committed.length === 0 && overlay === null && messages.status === "success" ? (
            <p className="muted">Nothing has been said yet.</p>
          ) : null}

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
        </div>
      </div>

      <footer className="chat-foot">
        <div className="chat-col chat-foot-col">
          <form className="stack composer" onSubmit={submit}>
            <div className="composer-field">
              <textarea
                ref={composerRef}
                className="composer-input"
                value={text}
                rows={1}
                placeholder="Ask the agent to do something in its worktree"
                aria-label="Prompt"
                onChange={(event) => setText(event.target.value)}
                onKeyDown={onKeyDown}
              />
              <button
                type="button"
                className="composer-expand"
                aria-label="Open the prompt in a large editor"
                title="Open in a large editor"
                onClick={() => setExpanded(true)}
              >
                <MaximizeIcon />
              </button>
            </div>
            {send.error === null ? null : (
              <p className="error" role="alert">
                {send.error.message}
              </p>
            )}
            <div className="row">
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
              <SendHint />
              {/* A touch screen has no ⌘/Ctrl key, so the shortcut gives way to a button. */}
              <button
                type="submit"
                className="button primary send-touch"
                disabled={send.isPending || text.trim() === ""}
              >
                {send.isPending ? "Sending…" : "Send"}
              </button>
            </div>
            {live.inbox.length === 0 ? null : (
              <p className="muted">{live.inbox.length} queued behind the running turn.</p>
            )}
          </form>
          {atBottom ? null : (
            <button
              type="button"
              className="jump-bottom"
              onClick={jumpToBottom}
              aria-label="Jump to the latest message"
            >
              ↓ Latest
            </button>
          )}
          <Modal open={expanded} title="Prompt" size="large" onClose={() => setExpanded(false)}>
            <div className="prompt-modal">
              <textarea
                className="composer-input composer-input-large"
                value={text}
                placeholder="Ask the agent to do something in its worktree"
                aria-label="Prompt"
                onChange={(event) => setText(event.target.value)}
                onKeyDown={onKeyDown}
              />
              <div className="row">
                <SendHint />
                <button
                  type="button"
                  className="button primary send-touch"
                  disabled={send.isPending || text.trim() === ""}
                  onClick={sendPrompt}
                >
                  {send.isPending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </Modal>
        </div>
      </footer>
    </section>
  );
}
