/** Minimal path-pattern router: literal segments plus `:name` captures. */

export interface RouteMatch {
  params: Record<string, string>;
}

/** Match a `pattern` such as `/projects/:id/git/status` against a concrete pathname. */
export function matchPath(pattern: string, pathname: string): RouteMatch | undefined {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");
  if (patternParts.length !== pathParts.length) return undefined;
  const params: Record<string, string> = {};
  for (const [index, expected] of patternParts.entries()) {
    const actual = pathParts[index] ?? "";
    if (expected.startsWith(":")) {
      if (actual === "") return undefined;
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return undefined;
    }
  }
  return { params };
}
