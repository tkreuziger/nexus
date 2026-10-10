import type { ReactElement } from "react";
import { useParams } from "react-router-dom";
import { FileBrowser } from "../components/FileBrowser.tsx";

export function ProjectFilesPage(): ReactElement {
  const { id = "" } = useParams();
  return (
    <section className="stack-lg">
      <h1>Files</h1>
      <p className="muted">
        Read-only. Paths come from the server's listings, so nothing here can leave the project
        root.
      </p>
      <FileBrowser projectId={id} />
    </section>
  );
}
