import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactElement, useState } from "react";
import { api } from "../api.ts";
import { Modal } from "./Modal.tsx";

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

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    register.mutate();
  };

  return (
    <Modal open={open} title="Register a project" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">
          A path to a directory that is already a git repository. Worktrees are created outside it.
        </p>

        <label htmlFor="new-project-path">Path</label>
        <input
          id="new-project-path"
          value={path}
          placeholder="/home/you/code/thing"
          aria-describedby={register.error === null ? undefined : "new-project-path-error"}
          onChange={(event) => setPath(event.target.value)}
          required
        />

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
