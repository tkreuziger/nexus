import type { WireFsEntry } from "@nexus/client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  useDeferredValue,
  useId,
  useState,
} from "react";
import { api } from "../api.ts";
import { Modal } from "./Modal.tsx";

/** How many suggestions are ever offered at once. */
const MAX_SUGGESTIONS = 8;

/**
 * The directory whose children complete the typed path: everything before the last `/`. A path with
 * no separator is relative to the server's home directory, and `/name` is relative to the root.
 */
function parentDirectory(path: string): string {
  const cut = path.lastIndexOf("/");
  if (cut === -1) return "";
  return cut === 0 ? "/" : path.slice(0, cut);
}

/** The segment being typed, which filters the parent directory's entries. */
function currentSegment(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

/** Register a repository. Kept in a dialog so the projects list stays a list. */
export function NewProjectDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const listId = useId();

  // Server-side autocomplete: only the server can read the filesystem. The suggestions are rendered
  // here rather than through a `datalist`, because a native datalist popup is not reliably shown.
  const directory = useDeferredValue(parentDirectory(path));
  const suggestions = useQuery({
    queryKey: ["fs", directory],
    queryFn: () => api.listFs(directory),
    enabled: open,
    placeholderData: keepPreviousData,
  });

  const segment = currentSegment(path).toLowerCase();
  const candidates = (suggestions.data?.entries ?? [])
    .filter((entry) => segment === "" || entry.name.toLowerCase().startsWith(segment))
    .slice(0, MAX_SUGGESTIONS);
  const showing = listOpen && candidates.length > 0;

  const register = useMutation({
    mutationFn: () =>
      name === "" ? api.createProject({ path }) : api.createProject({ path, name }),
    onSuccess: async () => {
      setPath("");
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
  });

  // A repository is a destination, so choosing one completes the path; a plain directory is a step,
  // so choosing one descends into it.
  const choose = (entry: WireFsEntry): void => {
    setPath(entry.git ? entry.path : `${entry.path}/`);
    setListOpen(false);
    setHighlight(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      setListOpen(false);
      return;
    }
    if (!showing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((index) => (index + 1) % candidates.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => (index - 1 + candidates.length) % candidates.length);
    } else if (event.key === "Enter") {
      const entry = candidates[highlight];
      if (entry !== undefined) {
        event.preventDefault();
        choose(entry);
      }
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    register.mutate();
  };

  return (
    <Modal open={open} title="Register a project" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">
          A path to a directory that is already a git repository. Worktrees are created outside it.
          Suggestions list directories as you type; a repository is marked.
        </p>

        <label htmlFor="new-project-path">Path</label>
        <div className="autocomplete">
          <input
            id="new-project-path"
            value={path}
            placeholder="/home/you/code/thing"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={showing}
            aria-controls={showing ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={highlight >= 0 ? `${listId}-${highlight}` : undefined}
            aria-describedby={register.error === null ? undefined : "new-project-path-error"}
            onChange={(event) => {
              setPath(event.target.value);
              setListOpen(true);
              setHighlight(-1);
            }}
            onFocus={() => setListOpen(true)}
            onBlur={() => setListOpen(false)}
            onKeyDown={onKeyDown}
            required
          />
          {showing ? (
            <div className="autocomplete-list" id={listId} role="listbox" aria-label="Suggestions">
              {candidates.map((entry, index) => (
                <button
                  key={entry.path}
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === highlight}
                  className="autocomplete-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(entry)}
                >
                  <span className="mono grow">{entry.path}/</span>
                  {entry.git ? <span className="muted">git</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <label htmlFor="new-project-name">Name (optional)</label>
        <input
          id="new-project-name"
          value={name}
          placeholder="defaults to the directory name"
          onChange={(event) => setName(event.target.value)}
        />

        {register.error === null ? null : (
          <p className="error" id="new-project-path-error" role="alert">
            {register.error.message}
          </p>
        )}

        <div className="row">
          <button type="submit" className="button primary" disabled={register.isPending}>
            {register.isPending ? "Registering…" : "Register"}
          </button>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
