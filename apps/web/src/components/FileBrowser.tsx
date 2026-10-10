import { useQuery } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import { api } from "../api.ts";
import { CodeBlock } from "../components/CodeBlock.tsx";
import { formatBytes } from "../format.ts";
import { languageFromPath } from "../highlight.ts";

const parentOf = (path: string): string => {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "" : path.slice(0, cut);
};

/**
 * Read-only browsing of a project's files. A directory and a selected file are separate state, so
 * closing a file returns to the directory the user was actually looking at.
 */
export function FileBrowser({ projectId }: { projectId: string }): ReactElement {
  const [dir, setDir] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const target = file ?? dir;

  const content = useQuery({
    queryKey: ["project", projectId, "content", target],
    queryFn: () => api.getProjectContent(projectId, target),
  });

  const crumbs = dir === "" ? [] : dir.split("/");

  return (
    <div className="card stack">
      <div className="row">
        <h2 className="section-title grow">Files</h2>
        {file === null ? null : (
          <button type="button" className="button" onClick={() => setFile(null)}>
            Close file
          </button>
        )}
      </div>

      {file === null ? (
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
      ) : (
        <p className="muted mono">{file}</p>
      )}

      {content.status === "pending" ? <p className="muted">Loading…</p> : null}
      {content.status === "error" ? (
        <p className="error" role="alert">
          {content.error.message}
        </p>
      ) : null}

      {content.status === "success" && content.data.content.kind === "directory" ? (
        content.data.content.entries.length === 0 ? (
          <p className="muted">Empty directory.</p>
        ) : (
          <ul className="list">
            {content.data.content.entries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="entry"
                  onClick={() =>
                    entry.type === "directory" ? setDir(entry.path) : setFile(entry.path)
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

      {content.status === "success" && content.data.content.kind === "file" ? (
        <>
          <p className="muted">{formatBytes(content.data.content.size)}</p>
          <CodeBlock text={content.data.content.text} language={languageFromPath(file ?? "")} />
          <div>
            <button
              type="button"
              className="button"
              onClick={() => {
                setDir(parentOf(file ?? ""));
                setFile(null);
              }}
            >
              Back to directory
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
