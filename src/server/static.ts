import { statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/** Types Bun does not infer from the extension but a browser will not accept without. */
const CONTENT_TYPES: Record<string, string> = {
  ".webmanifest": "application/manifest+json",
};

const contentTypeFor = (path: string): string | undefined => {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? undefined : CONTENT_TYPES[path.slice(dot)];
};

const isInside = (root: string, candidate: string): boolean =>
  candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

const notFound = (): Response => new Response("not found", { status: 404 });

async function indexResponse(root: string): Promise<Response> {
  const index = join(root, "index.html");
  if (statSync(index, { throwIfNoEntry: false })?.isFile() !== true) return notFound();
  return new Response(Bun.file(index), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * Serve the built web app from `root`: a real file when the path names one, and `index.html` otherwise
 * so client-side routes deep-link.
 *
 * Only reached when no API route matched, so it can never shadow the API. Paths are resolved and
 * containment-checked, so a traversal cannot escape `root`.
 */
export async function serveWebApp(root: string, request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  let relative: string;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const candidate = resolve(root, relative.replace(/^\/+/, ""));
  if (!isInside(root, candidate)) return indexResponse(root);
  if (statSync(candidate, { throwIfNoEntry: false })?.isFile() !== true) return indexResponse(root);
  const override = contentTypeFor(candidate);
  const file = Bun.file(candidate);
  return override === undefined
    ? new Response(file)
    : new Response(file, { headers: { "content-type": override } });
}
