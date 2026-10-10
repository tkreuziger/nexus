/** Narrowing helpers for values whose shape arrives as `unknown` (IPC params, Pi Durable entries, JSON). */

/** The value as a plain object, or `undefined`. Arrays and `null` are rejected. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The value as an array, or an empty array. */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The value as a non-empty string, or `undefined`. */
export function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
