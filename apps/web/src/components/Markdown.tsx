import DOMPurify from "dompurify";
import { marked } from "marked";
import { type ReactElement, useMemo } from "react";
import { highlight } from "../highlight.ts";

/**
 * Markdown for an assistant message.
 *
 * Agent output is untrusted text: a model can emit a `<script>` tag or a `javascript:` URL, and this
 * renders inside an authenticated session whose bearer token sits in `localStorage`. So the compiled
 * HTML is sanitized before it reaches the DOM — that is the whole reason DOMPurify is a dependency
 * here rather than a nicety.
 */

const fenceLanguage = (info: string | undefined): string | undefined => {
  const [first] = (info ?? "").trim().split(/\s+/);
  return first === undefined || first === "" ? undefined : first;
};

/** A fence's info string is model-authored, so only a plain token is allowed into the attribute. */
const languageAttribute = (language: string | undefined): string =>
  language !== undefined && /^[a-zA-Z0-9#+._-]+$/.test(language)
    ? ` class="language-${language}"`
    : "";

marked.use({
  gfm: true,
  // A chat message is written as loose lines, so a single newline should read as a line break.
  breaks: true,
  renderer: {
    // Fenced code goes through the same highlighter as tool output, so a snippet looks the same
    // wherever it appears. The raw HTML returned here is vetted by DOMPurify like everything else.
    code({ text, lang }) {
      const language = fenceLanguage(lang);
      const attribute = languageAttribute(language);
      return `<pre class="code"><code class="hljs"${attribute}>${highlight(text, language)}</code></pre>`;
    },
  },
});

// A link in a message should not navigate the app away from a running conversation.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function Markdown({ text }: { text: string }): ReactElement {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      className="markdown"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by DOMPurify in renderMarkdown
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Compile and sanitize one markdown document. Split out from the component so the trust boundary is
 * a named function that can be exercised on its own, without a React tree around it.
 */
export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }));
}
