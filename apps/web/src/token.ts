const STORAGE_KEY = "nexus.bearer";

/**
 * Storage access can throw — Safari's private mode, or a browser policy that disables storage — so
 * every access is guarded. A token that cannot be persisted still works for the current session.
 */
export function readToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Not fatal: the in-memory token still authenticates.
  }
}
