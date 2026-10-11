import type { WireSession } from "@nexus/client";
import type { ReactElement } from "react";
import { COMMANDS } from "../commands.ts";
import { formatTime } from "../format.ts";
import { Modal } from "./Modal.tsx";

/** Every command, from the same array the palette ranks, so the two cannot drift apart. */
export function CommandHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactElement {
  return (
    <Modal open={open} title="Commands" onClose={onClose}>
      <p className="muted">
        Typed at the start of the prompt. Picking one from the palette runs it; sending the text
        does not.
      </p>
      <ul className="list">
        {COMMANDS.map((command) => (
          <li key={command.name} className="row">
            <span className="mono">/{command.name}</span>
            <span className="muted grow">{command.summary}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** What the session is, beyond the one line the header has room for. */
export function SessionInfo({
  session,
  tokens,
  open,
  onClose,
}: {
  session: WireSession | null;
  tokens: string | null;
  open: boolean;
  onClose: () => void;
}): ReactElement {
  return (
    <Modal open={open} title="Session" onClose={onClose}>
      {session === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <dl className="facts">
          <dt>Name</dt>
          <dd className="mono">{session.name}</dd>
          <dt>Status</dt>
          <dd className="mono">{session.status}</dd>
          <dt>Model</dt>
          <dd className="mono">
            {session.model.provider}:{session.model.modelId}
          </dd>
          <dt>Thinking</dt>
          <dd className="mono">{session.thinkingLevel}</dd>
          <dt>Tokens</dt>
          <dd className="mono">{tokens ?? "—"}</dd>
          <dt>Branch</dt>
          <dd className="mono">{session.branch}</dd>
          <dt>Base</dt>
          <dd className="mono">{session.baseRef}</dd>
          <dt>Worktree</dt>
          <dd className="mono">{session.worktreePath}</dd>
          <dt>Conversation</dt>
          <dd className="mono">{session.conversationId ?? "—"}</dd>
          <dt>Created</dt>
          <dd className="mono">{formatTime(session.createdAt)}</dd>
          <dt>Id</dt>
          <dd className="mono">{session.id}</dd>
        </dl>
      )}
    </Modal>
  );
}
