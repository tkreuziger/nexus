import { type ReactElement, useEffect, useRef } from "react";
import { languageOf, monaco, prefersDark } from "../monaco.ts";

const themeName = () => (prefersDark() ? "vs-dark" : "vs");

/**
 * A read-only Monaco editor. One editor instance is created for the component's lifetime; selecting
 * another file re-points the model's language and value rather than rebuilding the widget, so
 * switching files stays cheap.
 */
export function CodeViewer({
  path,
  text,
  revealLine,
}: {
  path: string;
  text: string;
  revealLine: number | null;
}): ReactElement {
  const container = useRef<HTMLDivElement | null>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const lines = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    const node = container.current;
    if (node === null) return;
    const instance = monaco.editor.create(node, {
      value: "",
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      renderWhitespace: "selection",
      fixedOverflowWidgets: true,
      ariaLabel: "File contents, read-only",
    });
    editor.current = instance;
    lines.current = instance.createDecorationsCollection();
    return () => {
      instance.dispose();
      editor.current = null;
      lines.current = null;
    };
  }, []);

  useEffect(() => {
    monaco.editor.setTheme(themeName());
    const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    if (query === undefined) return;
    const apply = () => monaco.editor.setTheme(themeName());
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const instance = editor.current;
    const collection = lines.current;
    if (instance === null || collection === null) return;
    const model = instance.getModel();
    if (model === null) return;

    monaco.editor.setModelLanguage(model, languageOf(path));
    if (model.getValue() !== text) model.setValue(text);

    if (revealLine === null) {
      collection.clear();
      return;
    }
    const line = Math.max(1, Math.min(revealLine, model.getLineCount()));
    instance.revealLineInCenter(line);
    instance.setPosition({ lineNumber: line, column: 1 });
    collection.set([
      {
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: "viewer-line" },
      },
    ]);
  }, [path, text, revealLine]);

  return <div className="code-viewer" ref={container} />;
}
