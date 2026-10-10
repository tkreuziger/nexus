import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";
import cssWorker from "monaco-editor/language/css/css.worker.js?worker";
import htmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import jsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";

/**
 * Monaco is bundled locally (no CDN loader) and its language services run in Vite-bundled workers.
 * Only the editor worker is needed for read-only highlighting; the language workers cover JSON,
 * CSS, HTML, and TypeScript when a file of that kind is opened.
 */
globalThis.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

/** The Monaco language id for a file path, from its extension. Unicode files fall back to plain text. */
export function languageOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "dockerfile";
  if (name === "makefile" || name === "gnumakefile") return "makefile";
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? "" : name.slice(dot + 1);
  return LANGUAGES[extension] ?? "plaintext";
}

const LANGUAGES: Record<string, string> = {
  bat: "bat",
  c: "c",
  cc: "cpp",
  cfg: "ini",
  clj: "clojure",
  cljs: "clojure",
  cmake: "cmake",
  coffee: "coffeescript",
  conf: "ini",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cxx: "cpp",
  dart: "dart",
  diff: "diff",
  env: "ini",
  ex: "elixir",
  exs: "elixir",
  go: "go",
  gql: "graphql",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  hs: "haskell",
  htm: "html",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  json5: "json",
  jsonc: "json",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  md: "markdown",
  markdown: "markdown",
  mjs: "javascript",
  mts: "typescript",
  php: "php",
  pl: "perl",
  proto: "protobuf",
  ps1: "powershell",
  py: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  sass: "scss",
  scala: "scala",
  scss: "scss",
  sh: "shell",
  sql: "sql",
  swift: "swift",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  txt: "plaintext",
  vue: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
};

/** Whether the user has asked for a dark colour scheme, live-updating with the media query. */
export function prefersDark(): boolean {
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export { monaco };
