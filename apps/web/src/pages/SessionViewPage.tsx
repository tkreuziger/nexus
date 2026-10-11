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
  type ChangeEvent,
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
import { COMMANDS, type CommandContext } from "../commands.ts";
import { applyCompletion, detectTrigger, type Trigger } from "../completions.ts";
import { CodeBlock } from "../components/CodeBlock.tsx";
import { CommandHelp, SessionInfo } from "../components/CommandPanels.tsx";
import { type CompletionOption, Completions } from "../components/Completions.tsx";
import { ConversationTree, type TreePoint } from "../components/ConversationTree.tsx";
import { DiffView } from "../components/DiffView.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { Modal } from "../components/Modal.tsx";
import { SessionSettingsDialog } from "../components/SessionSettingsDialog.tsx";
import { asFileEdit } from "../diff.ts";
import { readDraft, writeDraft } from "../draft.ts";
import { fuzzyRank } from "../fuzzy.ts";

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

/** The gear for the session's own settings, in the header's top right. */
function GearIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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

/** A one-line excerpt of a message, for the conversation tree. */
function excerpt(text: string): string {
  const line = text.split("\n").find((entry) => entry.trim() !== "") ?? "";
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}

/** A tool call's arguments: a file edit reads as a patch, anything else as its JSON. */
function ToolBody({ args }: { args: unknown }): ReactElement | null {
  if (args === null) return null;
  const edit = asFileEdit(args);
  return edit === null ? (
    <pre className="code">{JSON.stringify(args, null, 2)}</pre>
  ) : (
    <DiffView edit={edit} />
  );
}

function Row({
  messageRole,
  content,
  streaming = false,
}: {
  messageRole: MessageRole;
  content: MirrorContent;
  /** True for the in-flight assistant message, so a growing trace can say it is still going. */
  streaming?: boolean;
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
      {content.thinking === undefined ? null : (
        <details className="msg-thinking">
          <summary className="thinking-summary">
            <span className="mono">thinking</span>
            <span className="muted">
              {streaming ? " · active" : ` · ${content.thinking.split("\n").length} lines`}
            </span>
          </summary>
          <div className="tool-output">
            <pre className="thinking">{content.thinking}</pre>
          </div>
        </details>
      )}
      {content.text === "" ? null : messageRole === "assistant" ? (
        <Markdown text={content.text} />
      ) : (
        <div className="msg-text">{content.text}</div>
      )}
      {content.toolCalls === undefined ? null : (
        <ul className="list">
          {content.toolCalls.map((call) => {
            const edit = asFileEdit(call.arguments);
            return (
              <li key={call.id}>
                <span className="mono muted">{call.name}</span>
                {edit === null ? (
                  <span className="mono muted"> {JSON.stringify(call.arguments)}</span>
                ) : (
                  <DiffView edit={edit} />
                )}
              </li>
            );
          })}
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
  // Fetched once per session and filtered in the browser: completing `@` should not re-walk the
  // worktree on every keystroke.
  const files = useQuery({
    queryKey: ["session-files", id],
    queryFn: () => api.listSessionFiles(id),
    staleTime: 30_000,
  });
  const worktreeFiles = files.status === "success" ? files.data.files : [];

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

  const [text, setText] = useState(() => readDraft(id));
  // The draft is per session, so switching sessions without remounting loads the other one's text.
  useEffect(() => {
    setText(readDraft(id));
  }, [id]);

  const onTextChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = event.target.value;
    setText(value);
    setCaret(event.target.selectionStart ?? value.length);
    // Typing reopens a list the reader dismissed, and starts the choice over.
    setDismissed(false);
    setSelected(0);
    // Persist on every keystroke, so a reload or an accidental navigation keeps the draft.
    writeDraft(id, value);
  };

  /** Arrow keys and clicks move the caret without changing the text. */
  const onCaretMove = (event: { currentTarget: HTMLTextAreaElement }): void => {
    setCaret(event.currentTarget.selectionStart ?? 0);
  };

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
  const modalRef = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Which command panel is up, if any. One piece of state, because only one can be. */
  const [panel, setPanel] = useState<"help" | "session" | "tree" | null>(null);

  // Which completion is on offer depends on the caret, so it is state rather than a ref: moving the
  // caret has to re-render the list.
  const [caret, setCaret] = useState(0);
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [activeField, setActiveField] = useState<"inline" | "modal">("inline");
  /** Set by a pick, applied after the render that carries the new text. */
  const pendingCaretRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = composerRef.current;
    if (element === null) return;
    element.style.height = "auto";
    const border = element.offsetHeight - element.clientHeight;
    element.style.height = `${element.scrollHeight + border}px`;
  });

  // A pick rewrites the text programmatically, so the caret has to be put back by hand — in whichever
  // of the two prompts is being typed in.
  useLayoutEffect(() => {
    const pending = pendingCaretRef.current;
    const element = activeField === "modal" ? modalRef.current : composerRef.current;
    if (pending === null || element === null) return;
    pendingCaretRef.current = null;
    element.focus();
    element.setSelectionRange(pending, pending);
  });

  const send = useMutation({
    mutationFn: () => api.submitMessage(id, { requestId, text }),
    onSuccess: async () => {
      setText("");
      writeDraft(id, "");
      setRequestId(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ["messages", id] });
    },
  });

  const abort = useMutation({ mutationFn: () => api.abortSession(id) });
  const reset = useMutation({ mutationFn: () => api.resetSession(id) });
  const compact = useMutation({ mutationFn: () => api.compactSession(id) });
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

  const committed = messages.status === "success" ? messages.data.messages : [];
  const overlay = live.message === null ? null : mirrorContentOfAssistant(live.message);
  // The stream's status is immediate; the polled one can lag a turn by seconds, which is exactly the
  // window in which someone would want to abort.
  const status = live.status ?? (session.status === "success" ? session.data.session.status : null);
  const detached = streamState === "unavailable" || streamState === "closed";

  // What the prompt is offering to complete. Worked out only while a trigger is active, so a
  // streaming turn pays nothing for any of this.
  const trigger: Trigger | null = dismissed ? null : detectTrigger(text, caret);
  const commandContext: CommandContext = {
    attached: !detached,
    reset: () => reset.mutate(),
    compact: () => compact.mutate(),
    help: () => setPanel("help"),
    info: () => setPanel("session"),
    tree: () => setPanel("tree"),
  };
  const options: CompletionOption[] =
    trigger === null
      ? []
      : trigger.kind === "command"
        ? fuzzyRank(
            trigger.query,
            COMMANDS.filter(
              (command) => command.available === undefined || command.available(commandContext),
            ),
            (command) => command.name,
            8,
          ).map(({ item, indices }) => ({
            id: `command:${item.name}`,
            label: item.name,
            detail: item.summary,
            indices,
            run: () => item.run(commandContext),
          }))
        : fuzzyRank(trigger.query, worktreeFiles, (file) => file, 8).map(({ item, indices }) => ({
            id: `file:${item}`,
            label: item,
            detail: "",
            indices,
          }));

  const pick = (option: CompletionOption): void => {
    if (trigger === null) return;
    // A command takes its own token away. A mention puts the path back with its `@` and a trailing
    // space — unless one is already there, which happens when completing mid-sentence.
    const following = text[trigger.end];
    const suffix = following === undefined || !/\s/.test(following) ? " " : "";
    const replacement = option.run === undefined ? `@${option.label}${suffix}` : "";
    const next = applyCompletion(text, trigger, replacement);
    setText(next.text);
    writeDraft(id, next.text);
    setCaret(next.caret);
    setSelected(0);
    pendingCaretRef.current = next.caret;
    option.run?.();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Sending wins: ⌘/Ctrl+Enter is unambiguous, and an open list must not swallow it.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendPrompt();
      return;
    }
    if (options.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((index) => (index + 1) % options.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((index) => (index - 1 + options.length) % options.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const option = options[selected];
      if (option !== undefined) pick(option);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissed(true);
    }
  };

  // The header names the model once; the branch is `pi/<name>` by construction, so repeating it there
  // would print the session's name a second time.
  const meta: string[] = [];
  if (session.status === "success") {
    meta.push(status ?? session.data.session.status);
    meta.push(`${session.data.session.model.provider}:${session.data.session.model.modelId}`);
  }
  const usageText = formatUsage(live.usage);
  if (usageText !== null) meta.push(usageText);

  // The conversation's user messages, for the tree panel.
  const treePoints: TreePoint[] = committed
    .filter((row) => row.role === "user")
    .map((row) => ({
      entryId: row.entryId,
      sequence: row.sequence,
      text: excerpt(parseMirrorContent(row.content).text),
    }));

  /** Put a chosen message at the top of the transcript, and stay there. */
  const jumpToEntry = (entryId: string): void => {
    const element = document.getElementById(`entry-${entryId}`);
    if (element === null) return;
    // Landing away from the bottom means the view should stay put rather than follow new output.
    stickRef.current = false;
    setAtBottom(false);
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
            <button
              type="button"
              className="chat-gear"
              aria-label="Session settings"
              title="Session settings"
              onClick={() => setSettingsOpen(true)}
            >
              <GearIcon />
            </button>
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

      {session.status === "success" ? (
        <SessionSettingsDialog
          sessionId={id}
          model={session.data.session.model}
          thinkingLevel={session.data.session.thinkingLevel}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-col chat-transcript">
          {messages.status === "pending" ? <p className="muted">Loading transcript…</p> : null}
          {messages.status === "error" ? (
            <p className="error" role="alert">
              {messages.error.message}
            </p>
          ) : null}
          {committed.map((row) => (
            // The wrapper carries the id the conversation tree jumps to.
            <div key={row.entryId} id={`entry-${row.entryId}`}>
              <Row messageRole={row.role} content={parseMirrorContent(row.content)} />
            </div>
          ))}
          {overlay === null ? null : <Row messageRole="assistant" content={overlay} streaming />}
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
                    {tool.args === null ? null : <ToolBody args={tool.args} />}
                    {tool.output === "" ? null : <pre className="code">{tool.output}</pre>}
                  </div>
                ) : (
                  <details key={tool.callId} className="card tool">
                    <summary className="mono">
                      {tool.name} <span className="muted">· done</span>
                    </summary>
                    {tool.args === null ? null : <ToolBody args={tool.args} />}
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
                role="combobox"
                aria-expanded={options.length > 0}
                aria-controls="completions"
                aria-autocomplete="list"
                aria-activedescendant={options.length === 0 ? undefined : `completions-${selected}`}
                onChange={onTextChange}
                onKeyDown={onKeyDown}
                onKeyUp={onCaretMove}
                onClick={onCaretMove}
                onFocus={(event) => {
                  setActiveField("inline");
                  onCaretMove(event);
                }}
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
              <div className="prompt-field">
                <textarea
                  ref={modalRef}
                  className="composer-input composer-input-large"
                  value={text}
                  placeholder="Ask the agent to do something in its worktree"
                  aria-label="Prompt"
                  role="combobox"
                  aria-expanded={options.length > 0}
                  aria-controls="completions"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    options.length === 0 ? undefined : `completions-${selected}`
                  }
                  onChange={onTextChange}
                  onKeyDown={onKeyDown}
                  onKeyUp={onCaretMove}
                  onClick={onCaretMove}
                  onFocus={(event) => {
                    setActiveField("modal");
                    onCaretMove(event);
                  }}
                />
              </div>
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

      <CommandHelp open={panel === "help"} onClose={() => setPanel(null)} />
      <SessionInfo
        session={session.status === "success" ? session.data.session : null}
        tokens={usageText}
        open={panel === "session"}
        onClose={() => setPanel(null)}
      />
      <ConversationTree
        points={treePoints}
        open={panel === "tree"}
        onClose={() => setPanel(null)}
        onJump={jumpToEntry}
      />

      <Completions
        id="completions"
        title={trigger?.kind === "command" ? "Commands" : "Files"}
        options={options}
        selected={selected}
        onPick={pick}
        onHover={setSelected}
        onDismiss={() => setDismissed(true)}
      />
    </section>
  );
}
