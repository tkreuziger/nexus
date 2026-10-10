/** Domain entities from the specification (§6.1), with branded identifiers so ids cannot be mixed. */

export type UserId = string & { readonly __brand: "UserId" };
export type AuthMethodId = string & { readonly __brand: "AuthMethodId" };
export type ProjectId = string & { readonly __brand: "ProjectId" };
export type SessionId = string & { readonly __brand: "SessionId" };

export type AuthMethodType = "api_key" | "oauth";

export interface User {
  id: UserId;
  handle: string;
  createdAt: string;
}

/** A stored credential. `credentialCiphertext` is the `v1.<iv>.<tag>.<ct>` envelope; never plaintext. */
export interface AuthMethod {
  id: AuthMethodId;
  userId: UserId;
  type: AuthMethodType;
  provider: string;
  label: string;
  credentialCiphertext: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface Project {
  id: ProjectId;
  ownerId: UserId;
  name: string;
  path: string;
  assignedAuthMethodId: AuthMethodId | null;
  createdAt: string;
}

export type SessionStatus = "starting" | "idle" | "running" | "stopped" | "crashed";

export interface Session {
  id: SessionId;
  projectId: ProjectId;
  name: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  model: ModelRef;
  /** Pi Durable's conversation id inside the session's own store; assigned at first init. */
  conversationId: string | null;
  status: SessionStatus;
  pid: number | null;
  createdAt: string;
}

export type MessageRole = "user" | "assistant" | "tool" | "meta";

/** Full transcript row, persisted independently of Pi Durable compaction. */
export interface MessageMirrorRow {
  sessionId: SessionId;
  sequence: number;
  entryId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export interface ModelRef {
  provider: string;
  modelId: string;
}
