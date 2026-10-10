/** Narrowing for params arriving over IPC: both ends are ours, but the wire is still untrusted input. */
import { HttpError } from "../errors.ts";
import { asRecord } from "../records.ts";
import type {
  CredentialModifyParams,
  CredentialReadParams,
  EntryParams,
  EventParams,
  FaultParams,
  InitParams,
  ReadyParams,
  StatusParams,
  SubmitParams,
  SubscribeParams,
  UnsubscribeParams,
} from "./messages.ts";

const asObject = (value: unknown, label: string): Record<string, unknown> => {
  const record = asRecord(value);
  if (record === undefined) throw new Error(`${label}: expected an object`);
  return record;
};

const asString = (source: Record<string, unknown>, key: string, label: string): string => {
  const value = source[key];
  if (typeof value !== "string" || value === "")
    throw new Error(`${label}: "${key}" must be a string`);
  return value;
};

const asNumber = (source: Record<string, unknown>, key: string, label: string): number => {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}: "${key}" must be a number`);
  }
  return value;
};

export function asInitParams(value: unknown): InitParams {
  const source = asObject(value, "init");
  const model = asObject(source.model, "init.model");
  const compaction = asObject(source.compaction, "init.compaction");
  const authMethodId = source.authMethodId;
  if (authMethodId !== null && typeof authMethodId !== "string") {
    throw new Error('init: "authMethodId" must be a string or null');
  }
  return {
    sessionId: asString(source, "sessionId", "init"),
    cwd: asString(source, "cwd", "init"),
    dbPath: asString(source, "dbPath", "init"),
    model: {
      provider: asString(model, "provider", "init.model"),
      modelId: asString(model, "modelId", "init.model"),
    },
    authMethodId,
    compaction: {
      reserveTokens: asNumber(compaction, "reserveTokens", "init.compaction"),
      keepRecentTokens: asNumber(compaction, "keepRecentTokens", "init.compaction"),
    },
  };
}

export function asSubmitParams(value: unknown): SubmitParams {
  const source = asObject(value, "submit");
  return {
    requestId: asString(source, "requestId", "submit"),
    text: asString(source, "text", "submit"),
  };
}

export function asReadyParams(value: unknown): ReadyParams {
  return { conversationId: asString(asObject(value, "ready"), "conversationId", "ready") };
}

export function asStatusParams(value: unknown): StatusParams {
  const status = asObject(value, "status").status;
  if (status !== "idle" && status !== "running")
    throw new Error('status: expected "idle" or "running"');
  return { status };
}

export function asEntryParams(value: unknown): EntryParams {
  return { entry: asObject(value, "entry").entry };
}

export function asEventParams(value: unknown): EventParams {
  const source = asObject(value, "event");
  const events = source.events;
  if (!Array.isArray(events)) throw new Error('event: "events" must be an array');
  return { subscriptionId: asString(source, "subscriptionId", "event"), events };
}

export function asSubscribeParams(value: unknown): SubscribeParams {
  return { subscriptionId: asString(asObject(value, "subscribe"), "subscriptionId", "subscribe") };
}

export function asUnsubscribeParams(value: unknown): UnsubscribeParams {
  return {
    subscriptionId: asString(asObject(value, "unsubscribe"), "subscriptionId", "unsubscribe"),
  };
}

export function asFaultParams(value: unknown): FaultParams {
  return { message: asString(asObject(value, "fault"), "message", "fault") };
}

export function asCredentialReadParams(value: unknown): CredentialReadParams {
  return { provider: asString(asObject(value, "credential.read"), "provider", "credential.read") };
}

export function asCredentialModifyParams(value: unknown): CredentialModifyParams {
  const source = asObject(value, "credential.modify");
  const credential = source.credential;
  if (credential !== null && (typeof credential !== "object" || Array.isArray(credential))) {
    throw new Error('credential.modify: "credential" must be an object or null');
  }
  return {
    provider: asString(source, "provider", "credential.modify"),
    credential: credential as CredentialModifyParams["credential"],
  };
}

/** Turn an IPC validation failure into a 400 so a buggy peer cannot 500 the server. */
export const asBadRequest = (error: unknown): HttpError =>
  new HttpError(400, error instanceof Error ? error.message : "invalid IPC frame");
