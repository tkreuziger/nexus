import type { ReactElement } from "react";
import { diffLines, type FileEdit } from "../diff.ts";

/** Mark a line as removed or added the way a patch does, then colour it. */
const MARK: Record<string, string> = { same: " ", removed: "-", added: "+" };

/**
 * A file edit as a patch: the path, then one hunk per change, removed lines above added ones.
 *
 * Inline rather than side by side — a chat column is narrow, and two columns of code in one reads
 * worse than one column with the change marked.
 */
export function DiffView({ edit }: { edit: FileEdit }): ReactElement {
  // Keyed by the change itself, so the key does not depend on the position in the list.
  const hunks = edit.edits.map((change) => ({
    id: `${change.oldText}\u0000${change.newText}`,
    lines: diffLines(change.oldText, change.newText),
  }));

  return (
    <div className="diff">
      <p className="diff-path mono">{edit.path}</p>
      {hunks.map((hunk) => {
        // A running character offset, which is unique within the hunk and stable across renders.
        let offset = 0;
        return (
          <pre className="diff-hunk" key={hunk.id}>
            {hunk.lines.map((line) => {
              const at = offset;
              offset += line.text.length + 1;
              return (
                <span className={`diff-line diff-${line.kind}`} key={at}>
                  {MARK[line.kind]}
                  {line.text}
                  {"\n"}
                </span>
              );
            })}
          </pre>
        );
      })}
    </div>
  );
}
