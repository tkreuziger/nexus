import type { WireGitCommit } from "@nexus/client";
import type { ReactElement } from "react";
import { formatTime } from "../format.ts";

export function CommitList({ commits }: { commits: WireGitCommit[] }): ReactElement {
  if (commits.length === 0) return <p className="muted">No commits.</p>;
  return (
    <ul className="list">
      {commits.map((commit) => (
        <li key={commit.sha} className="commit">
          <span className="mono muted">{commit.sha.slice(0, 8)}</span>
          <span className="grow">{commit.subject}</span>
          <span className="muted">{commit.author}</span>
          <span className="muted">{formatTime(commit.date)}</span>
        </li>
      ))}
    </ul>
  );
}
