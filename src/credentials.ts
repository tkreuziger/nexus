import type { Credential } from "@earendil-works/pi-ai";
import { HttpError } from "./errors.ts";
import { asNonEmptyString, asRecord } from "./records.ts";

/** True for a value shaped like a pi-ai credential, checked field by field. */
export function isCredential(value: unknown): value is Credential {
  const record = asRecord(value);
  if (record === undefined) return false;
  if (record.type === "api_key") {
    return record.key === undefined || typeof record.key === "string";
  }
  return (
    record.type === "oauth" &&
    typeof record.refresh === "string" &&
    typeof record.access === "string" &&
    typeof record.expires === "number"
  );
}

/**
 * Read a credential from a request body (§3.1): either an API key or an OAuth token set. The
 * result is the exact value encrypted at rest and later handed to the harness.
 */
export function parseCredentialInput(body: Record<string, unknown>): Credential {
  if (body.type === "api_key") {
    const key = asNonEmptyString(body.key);
    if (key === undefined) throw new HttpError(400, '"key" is required for an api_key method');
    return { type: "api_key", key };
  }
  if (body.type === "oauth") {
    const credential = asRecord(body.credential);
    if (credential === undefined) {
      throw new HttpError(400, '"credential" is required for an oauth method');
    }
    const candidate = {
      type: "oauth",
      refresh: credential.refresh,
      access: credential.access,
      expires: credential.expires,
    };
    if (!isCredential(candidate)) {
      throw new HttpError(
        400,
        'an oauth credential needs string "refresh" and "access" and a numeric "expires"',
      );
    }
    return candidate;
  }
  throw new HttpError(400, '"type" must be "api_key" or "oauth"');
}
