/** Errors the client raises. Both carry the HTTP status so callers can branch without parsing messages. */

import type { WireError } from "./wire.ts";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * The session has no running harness process, so there is nothing to attach to (HTTP 409). This is a
 * session *state*, not a failure: the UI shows it and retries, because a restart makes it recoverable.
 */
export class StreamUnavailableError extends ApiError {
  constructor(message = "session is not running") {
    super(409, message);
    this.name = "StreamUnavailableError";
  }
}

const isWireError = (value: unknown): value is WireError => {
  if (typeof value !== "object" || value === null) return false;
  const envelope = (value as { error?: unknown }).error;
  return (
    typeof envelope === "object" &&
    envelope !== null &&
    typeof (envelope as { message?: unknown }).message === "string"
  );
};

/** Turn a non-2xx response into an `ApiError`, preferring the server's message over the status line. */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  const fallback = `${response.status} ${response.statusText}`.trim();
  const payload: unknown = await response.json().catch(() => undefined);
  return new ApiError(response.status, isWireError(payload) ? payload.error.message : fallback);
}
