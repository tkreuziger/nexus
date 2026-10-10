/** Message shapes exchanged between the server and a harness process (ADR-1). */
import type { Credential } from "@earendil-works/pi-ai";
import type { ModelRef, SessionStatus, ThinkingLevel } from "../types.ts";

/** Methods the server calls on the harness. */
export const SERVER_METHODS = {
  init: "init",
  configure: "configure",
  submit: "submit",
  abort: "abort",
  subscribe: "subscribe",
  unsubscribe: "unsubscribe",
  shutdown: "shutdown",
} as const;

/** Methods the harness calls on the server. */
export const HARNESS_METHODS = {
  ready: "ready",
  event: "event",
  entry: "entry",
  status: "status",
  fault: "fault",
  credentialRead: "credential.read",
  credentialList: "credential.list",
  credentialModify: "credential.modify",
  credentialDelete: "credential.delete",
} as const;

export interface InitParams {
  sessionId: string;
  cwd: string;
  dbPath: string;
  model: ModelRef;
  thinkingLevel: ThinkingLevel;
  authMethodId: string | null;
  compaction: { reserveTokens: number; keepRecentTokens: number };
}

/**
 * Change what the conversation runs with. Applied to the next request rather than the one in flight,
 * which is Pi Durable's own rule for `configure`.
 */
export interface ConfigureParams {
  model: ModelRef;
  thinkingLevel: ThinkingLevel;
}

export interface InitResult {
  conversationId: string;
}

export interface SubmitParams {
  requestId: string;
  text: string;
}

export interface SubmitResult {
  submissionId: string;
  status: string;
}

export interface ReadyParams {
  conversationId: string;
}

/** One attached event stream. Pi captures a fresh snapshot plus the registration atomically (§3.4). */
export interface SubscribeParams {
  subscriptionId: string;
}

export interface UnsubscribeParams {
  subscriptionId: string;
}

/** One Pi Durable `AgentEvent` batch for one subscription. Forwarded opaquely to that SSE client. */
export interface EventParams {
  subscriptionId: string;
  events: readonly unknown[];
}

/** One committed `EntryRecord`, forwarded opaquely and interpreted by the mirror. */
export interface EntryParams {
  entry: unknown;
}

export interface StatusParams {
  status: Extract<SessionStatus, "idle" | "running">;
}

export interface FaultParams {
  message: string;
}

export interface CredentialReadParams {
  provider: string;
}

export interface CredentialModifyParams {
  provider: string;
  credential: Credential | null;
}

export interface CredentialResult {
  credential: Credential | null;
}

/** Non-secret credential metadata for the harness's `CredentialStore.list`. */
export interface CredentialListResult {
  infos: readonly { providerId: string; type: Credential["type"] }[];
}
