const KEY_PREFIX = "nexus.draft.";

const keyFor = (sessionId: string): string => `${KEY_PREFIX}${sessionId}`;

/**
 * The unsent prompt for a session. Kept in local storage so navigating away — or reloading, or
 * following a link — does not discard what was being typed. Storage can throw (Safari private mode,
 * or a policy that disables it), so every access is guarded; a draft that cannot be persisted simply
 * lives for the current view.
 */
export function readDraft(sessionId: string): string {
  try {
    return localStorage.getItem(keyFor(sessionId)) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(sessionId: string, text: string): void {
  try {
    if (text === "") localStorage.removeItem(keyFor(sessionId));
    else localStorage.setItem(keyFor(sessionId), text);
  } catch {
    // Not fatal: the draft still lives in the textarea.
  }
}
