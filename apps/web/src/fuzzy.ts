/**
 * Subsequence matching, scored so the candidate a person meant sorts first.
 *
 * The command palette and the file mention list both rank with this, so the ranking only has to be
 * right in one place. Pure and dependency-free, which is what makes it testable on its own.
 */

export interface FuzzyMatch {
  score: number;
  /** Indices in the target that the query matched, for highlighting. */
  indices: number[];
}

/** Anything that is not a word character starts a new word in a path or an identifier. */
const BOUNDARY = /[^a-zA-Z0-9]/;

/**
 * Match `query` against `target` as a subsequence, or return null when it does not fit.
 *
 * An empty query matches everything equally, which is what makes an empty mention list show the
 * first files rather than nothing.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  if (query === "") return { score: 0, indices: [] };
  const needle = query.toLowerCase();
  const haystack = target.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let previous = -2;
  let position = 0;

  for (const character of needle) {
    const found = haystack.indexOf(character, position);
    if (found === -1) return null;
    // Runs of adjacent characters, and matches that begin a word, are what make a result feel right.
    if (found === previous + 1) score += 8;
    if (found === 0 || BOUNDARY.test(haystack[found - 1] ?? "")) score += 6;
    // A gap costs, but never as much as the character failing to match at all.
    score -= Math.min(found - previous - 1, 10);
    indices.push(found);
    previous = found;
    position = found + 1;
  }

  // Between two equally matched candidates, prefer the shorter — `a.ts` over `a/b/c/deep.ts`.
  score -= Math.floor(target.length / 8);
  return { score, indices };
}

export interface Ranked<T> {
  item: T;
  score: number;
  indices: number[];
}

/** Rank `items` by how well `key(item)` matches `query`, best first, keeping at most `limit`. */
export function fuzzyRank<T>(
  query: string,
  items: readonly T[],
  key: (item: T) => string,
  limit: number,
): Ranked<T>[] {
  const ranked: Ranked<T>[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, key(item));
    if (match === null) continue;
    ranked.push({ item, score: match.score, indices: match.indices });
  }
  // Stable by score alone: the input order is already the order the source produced, and ties are
  // better left in that order than shuffled by an arbitrary secondary key.
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}
