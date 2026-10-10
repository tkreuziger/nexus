import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * Syntax highlighting for every code surface in the app: a fenced block in a message, tool output,
 * and the file viewer.
 *
 * `highlight.js/lib/core` ships no grammars, so the set below is the entire cost of the feature. The
 * full package carries a megabyte of grammars this app would never render; naming them here is what
 * keeps that out of the bundle. An unlisted language still works — it just falls back to detection.
 */

const LANGUAGES = {
  bash,
  css,
  diff,
  go,
  javascript,
  json,
  markdown,
  plaintext,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};

for (const [name, language] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, language);
}

/** Names a fence or an extension uses that the grammar itself does not answer to. */
const ALIASES: Record<string, string> = {
  cjs: "javascript",
  console: "bash",
  htm: "xml",
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  md: "markdown",
  mjs: "javascript",
  patch: "diff",
  py: "python",
  scss: "css",
  sh: "bash",
  shell: "bash",
  svg: "xml",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
  zsh: "bash",
};

for (const [alias, language] of Object.entries(ALIASES)) {
  hljs.registerAliases(alias, { languageName: language });
}

/** File extensions the viewer can name a grammar for; anything else falls back to detection. */
const EXTENSIONS: Record<string, string> = {
  bash: "bash",
  cjs: "javascript",
  css: "css",
  diff: "diff",
  go: "go",
  htm: "xml",
  html: "xml",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  md: "markdown",
  mjs: "javascript",
  patch: "diff",
  py: "python",
  rs: "rust",
  scss: "css",
  sh: "bash",
  sql: "sql",
  svg: "xml",
  ts: "typescript",
  tsx: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

/** The language for a path's extension, or undefined when the extension says nothing useful. */
export function languageFromPath(path: string): string | undefined {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return undefined;
  return EXTENSIONS[path.slice(dot + 1).toLowerCase()];
}

const asPlainText = (text: string): string =>
  hljs.highlight(text, { language: "plaintext", ignoreIllegals: true }).value;

/**
 * Highlight `text` as `language`, or guess at it. Auto-detection earns its keep on a snippet and is a
 * liability on a wall of build output, so anything long or unconvincing is left as escaped plain text
 * rather than coloured at random.
 *
 * The result is HTML with every source character escaped and only `<span>` wrappers added, which is
 * what makes it safe to inject directly without a sanitizer pass.
 */
export function highlight(text: string, language?: string | undefined): string {
  if (language !== undefined && hljs.getLanguage(language) !== undefined) {
    return hljs.highlight(text, { language, ignoreIllegals: true }).value;
  }
  if (text.length > 20_000) return asPlainText(text);
  const guess = hljs.highlightAuto(text);
  return guess.relevance < 5 ? asPlainText(text) : guess.value;
}
