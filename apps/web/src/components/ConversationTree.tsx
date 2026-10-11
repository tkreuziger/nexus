import type { ReactElement } from "react";
import { Modal } from "./Modal.tsx";

/** One place the conversation can be read from: a user message and where it sits in the transcript. */
export interface TreePoint {
  entryId: string;
  sequence: number;
  /** A one-line excerpt, so a row is recognisable without opening it. */
  text: string;
}

/**
 * The conversation's user messages, oldest first, to jump the transcript to one.
 *
 * Navigation only for now: continuing from a point means forking, which is a larger change than a
 * panel — see the note in the reply.
 */
export function ConversationTree({
  points,
  open,
  onClose,
  onJump,
}: {
  points: readonly TreePoint[];
  open: boolean;
  onClose: () => void;
  onJump: (entryId: string) => void;
}): ReactElement {
  return (
    <Modal open={open} title="Conversation" onClose={onClose}>
      {points.length === 0 ? (
        <p className="muted">Nothing has been said yet.</p>
      ) : (
        <ul className="list">
          {points.map((point) => (
            <li key={point.entryId}>
              <button
                type="button"
                className="entry"
                onClick={() => {
                  onJump(point.entryId);
                  onClose();
                }}
              >
                <span className="mono muted">{point.sequence}</span> <span>{point.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
