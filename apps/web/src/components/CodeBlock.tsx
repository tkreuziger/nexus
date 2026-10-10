import { type ReactElement, useMemo } from "react";
import { highlight } from "../highlight.ts";

/**
 * A highlighted, read-only block of code.
 *
 * The HTML comes from highlight.js, which escapes the source itself and only ever adds `<span>`
 * wrappers, so there is nothing here for a sanitizer to strip — unlike the markdown path, where the
 * input can carry tags of its own.
 */
export function CodeBlock({
  text,
  language,
}: {
  text: string;
  language?: string | undefined;
}): ReactElement {
  const html = useMemo(() => highlight(text, language), [text, language]);
  return (
    <pre className="code">
      <code
        className="hljs"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: highlight.js escapes the source text itself
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
  );
}
