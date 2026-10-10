/** Serializes work per key, so concurrent requests for one project cannot race (§7). */
export class KeyedLock {
  readonly #chains = new Map<string, Promise<unknown>>();

  /** Run `operation` after every previously queued operation for `key` has settled. */
  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#chains.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    this.#chains.set(
      key,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }
}
