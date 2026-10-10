import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { lazy, type ReactElement, Suspense, useDeferredValue, useState } from "react";
import { api } from "../api.ts";
import { formatBytes } from "../format.ts";

/**
 * Monaco is a large dependency, so it is loaded in its own chunk the first time a file is opened;
 * browsing directories and searching stay off that cost.
 */
const CodeViewer = lazy(() =>
  import("./CodeViewer.tsx").then((module) => ({ default: module.CodeViewer })),
);

const parentOf = (path: string): string => {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "" : path.slice(0, cut);
};

/**
 * Read-only file explorer: a directory navigator on the left, a Monaco viewer on the right, and a
 * content search that replaces the navigator with matches. Every path comes from a server listing or
 * a server match, so the client never constructs one to send.
 */
export function FileBrowser({ projectId }: { projectId: string }): ReactElement {
  const [dir, setDir] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [revealLine, setRevealLine] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query.trim());

  const listing = useQuery({
    queryKey: ["project", projectId, "content", dir],
    queryFn: () => api.getProjectContent(projectId, dir),
  });

  const content = useQuery({
    queryKey: ["project", projectId, "content", file],
    queryFn: () => api.getProjectContent(projectId, file ?? ""),
    enabled: file !== null,
  });

  const matches = useQuery({
    queryKey: ["project", projectId, "search", search],
    queryFn: () => api.searchProject(projectId, search),
    enabled: search !== "",
    placeholderData: keepPreviousData,
  });

  const open = (path: string, line: number | null) => {
    setFile(path);
    setRevealLine(line);
  };

  const openMatch = (path: string, line: number) => {
    setDir(parentOf(path));
    open(path, line);
  };

  const crumbs = dir === "" ? [] : dir.split("/");

  return (
    <div className="card stack files">
      <div className="row">
        <h2 className="section-title grow">Files</h2>
        <input
          className="search-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search file contents…"
          aria-label="Search file contents"
        />
      </div>

      <div className="files-split">
        <div className="files-tree">
          {search === "" ? (
            <>
              <nav className="crumbs" aria-label="Directory">
                <button type="button" className="crumb" onClick={() => setDir("")}>
                  root
                </button>
                {crumbs.map((crumb, index) => (
                  <span key={crumbs.slice(0, index + 1).join("/")}>
                    <span className="muted"> / </span>
                    <button
                      type="button"
                      className="crumb"
                      onClick={() => setDir(crumbs.slice(0, index + 1).join("/"))}
                    >
                      {crumb}
                    </button>
                  </span>
                ))}
              </nav>

              {listing.status === "pending" ? <p className="muted">Loading…</p> : null}
              {listing.status === "error" ? (
                <p className="error" role="alert">
                  {listing.error.message}
                </p>
              ) : null}
              {listing.status === "success" && listing.data.content.kind === "directory" ? (
                listing.data.content.entries.length === 0 ? (
                  <p className="muted">Empty directory.</p>
                ) : (
                  <ul className="list">
                    {listing.data.content.entries.map((entry) => (
                      <li key={entry.path}>
                        <button
                          type="button"
                          className={entry.path === file ? "entry entry-open" : "entry"}
                          aria-current={entry.path === file ? "true" : undefined}
                          onClick={() =>
                            entry.type === "directory" ? setDir(entry.path) : open(entry.path, null)
                          }
                        >
                          <span className="mono">{entry.name}</span>
                          {entry.type === "directory" ? <span className="muted"> /</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </>
          ) : (
            <>
              {matches.status === "error" ? (
                <p className="error" role="alert">
                  {matches.error.message}
                </p>
              ) : null}
              {matches.status === "success" && matches.data.matches.length === 0 ? (
                <p className="muted" role="status">
                  No matches.
                </p>
              ) : null}
              {matches.status === "success" && matches.data.matches.length > 0 ? (
                <>
                  <p className="muted results-count" role="status">
                    {matches.data.matches.length}
                    {matches.data.truncated ? "+" : ""} matches
                  </p>
                  <ul className="list">
                    {matches.data.matches.map((match) => (
                      <li key={`${match.path}:${match.line}:${match.column}`}>
                        <button
                          type="button"
                          className="entry"
                          onClick={() => openMatch(match.path, match.line)}
                        >
                          <span className="mono match-path">
                            {match.path}:{match.line}
                          </span>
                          <span className="muted match-text">{match.text.trimStart()}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          )}
        </div>

        <div className="files-view">
          {file === null ? (
            <p className="muted">Select a file to view it.</p>
          ) : (
            <>
              <div className="row files-view-head">
                <span className="mono grow" title={file}>
                  {file}
                </span>
                {content.status === "success" && content.data.content.kind === "file" ? (
                  <span className="muted">{formatBytes(content.data.content.size)}</span>
                ) : null}
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setFile(null);
                    setRevealLine(null);
                  }}
                >
                  Clear
                </button>
              </div>
              {content.status === "pending" ? <p className="muted">Loading…</p> : null}
              {content.status === "error" ? (
                <p className="error" role="alert">
                  {content.error.message}
                </p>
              ) : null}
              {content.status === "success" && content.data.content.kind === "file" ? (
                <Suspense fallback={<p className="muted">Loading viewer…</p>}>
                  <CodeViewer
                    path={content.data.content.path}
                    text={content.data.content.text}
                    revealLine={revealLine}
                  />
                </Suspense>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
