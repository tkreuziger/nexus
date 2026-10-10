/**
 * The callable part of `fetch`. Bun's `fetch` also carries a `preconnect` property, so `typeof fetch`
 * is wider than anything a client or a test fake needs to provide.
 */
export type FetchLike = (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) => Promise<Response>;

/**
 * The global `fetch`, wrapped so it can be stored in a field or passed around.
 *
 * A browser's `fetch` must be invoked with the global object as its receiver. Extracting it into a
 * field and calling it as a method throws `Illegal invocation` — Bun does not care, so the mistake
 * only surfaces in a browser. Wrapping also means a test that replaces `globalThis.fetch` is picked
 * up at call time rather than at construction time.
 */
export const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);
