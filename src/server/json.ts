import { HttpError } from "../errors.ts";

/** Read a request body as a JSON object, rejecting anything else with 400. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await request.json().catch(() => undefined);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "request body must be a JSON object");
  }
  // The guard above establishes an object with unknown-valued properties.
  return parsed as Record<string, unknown>;
}

/** Read an optional string field, rejecting a present-but-wrong-type value with 400. */
export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value === "") {
    throw new HttpError(400, `"${key}" must be a non-empty string`);
  }
  return value;
}

/** Read a required string field, rejecting a missing or wrong-type value with 400. */
export function requiredString(body: Record<string, unknown>, key: string): string {
  const value = optionalString(body, key);
  if (value === undefined) throw new HttpError(400, `"${key}" is required`);
  return value;
}

/** Read a positive integer query parameter, applying a default and a ceiling. */
export function boundedInt(url: URL, key: string, fallback: number, max: number): number {
  const raw = url.searchParams.get(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1)
    throw new HttpError(400, `"${key}" must be a positive integer`);
  return Math.min(value, max);
}
