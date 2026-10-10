# ADR-9: Messages are rendered as markdown, with highlighting by highlight.js

An assistant message arrives as markdown — headings, lists, fenced code, tables — and the chat view rendered it as plain text in a `<pre>`. Tool output and the file viewer were plain text too.

## Context

Rendering either of these well needs two things the app did not have: a markdown compiler and a syntax highlighter. `docs/plans/web-frontend.md` had put "rich text or markdown rendering of messages" explicitly out of scope, so neither was a dependency.

Three facts shape the choice:

- **The input is untrusted.** A model can emit a `<script>` tag, an `<img onerror=…>`, or a `javascript:` URL. The chat view runs in an authenticated session whose bearer token lives in `localStorage` (ADR-8), so a successful injection can read the token and call the API as the user. Markdown compiled to HTML must be sanitized, not merely escaped.
- **This is display, not editing.** Nothing in the app edits code; the file browser is read-only by design and tool output is a transcript. An editor is the wrong shape for the job.
- **highlight.js ships no grammars with its core.** `highlight.js/lib/core` plus a named list of languages is a few tens of KB; the full bundle is a megabyte of grammars this app would never render.

## Decision

**`marked` compiles markdown, `dompurify` sanitizes it, and `highlight.js` colours code.** All three are dependencies of `apps/web` only.

- `marked` is configured once in `apps/web/src/components/Markdown.tsx` with GFM and `breaks: true` — a chat message is written as loose lines, so a single newline should read as a line break.
- Its `code` renderer is overridden so a fenced block goes through the same highlighter as everything else, and a snippet looks identical wherever it appears.
- **Every compiled document goes through `DOMPurify.sanitize` before it reaches the DOM.** This is the load-bearing part of the decision, not a detail of it.
- `apps/web/src/highlight.ts` registers the grammars by hand — bash, css, diff, go, javascript, json, markdown, plaintext, python, rust, sql, typescript, xml, yaml — plus the aliases fences and extensions actually use.
- Highlighting is applied to assistant messages, tool output, and the file viewer. User messages stay plain text, since what a person typed is already what they meant.

## Consequences

- The token CSS is hand-written against the app's existing variables (`--accent`, `--success`, `--warning`, `--error`, `--muted`) rather than imported from `highlight.js/styles/*`. One rule set therefore covers light and dark, because every variable it reads is already redefined in the dark media query — and no theme stylesheet ships to the browser.
- Unlisted languages still highlight: `highlight()` falls back to `highlightAuto`. Detection is skipped for text over 20 KB or when relevance is low, so a wall of build output stays plain instead of being coloured at random.
- A markdown document is sanitized on every render of every message. `useMemo` on the text keeps that to once per message body.
- Links in a message open in a new tab. A stray link should not navigate the app away from a running conversation.
- Fenced code and tool output both inject `innerHTML`, from two different sources with two different trust levels: markdown is sanitized, and highlight.js output is not, because it escapes every source character itself and only adds `<span>` wrappers. That asymmetry is deliberate and is documented at each call site.
- Sanitizing strips GFM task-list checkboxes, since `input` is not in DOMPurify's default allowlist. The list text survives.

## Alternatives rejected

- **`monaco-editor`.** It is a full editor: ~5 MB, web workers, and a dynamic import, to display text that is never edited. Rejected on shape, not only on size.
- **`shiki`.** Better themes and a more accurate tokenizer, but far larger and asynchronous, which would put a loading state in front of every message.
- **Hand-written markdown or highlighting.** Both are the kind of code that looks correct until it meets real input, and a hand-rolled sanitizer is how XSS gets in.
- **`marked` without a sanitizer.** Rejected outright; see the untrusted-input constraint above.

## Related

- `docs/plans/web-frontend.md` — the frontend plan, which had markdown out of scope
- `docs/architecture/adrs/0008-web-frontend-origin.md` — why a token in `localStorage` makes injection expensive
- `apps/web/src/highlight.ts`, `apps/web/src/components/Markdown.tsx`, `apps/web/src/components/CodeBlock.tsx`
