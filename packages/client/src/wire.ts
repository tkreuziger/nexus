/**
 * The wire contract: the request and response shapes of every route, and the frames of the session
 * event stream. The server imports these types and annotates its handlers with them, so a change that
 * breaks a client fails `tsc` rather than reaching a browser as a runtime bug.
 *
 * Ids are plain strings here. The server's own entity types carry branded ids, which are assignable
 * to these; branding is an internal safety measure, not part of the contract.
 */

import type { AgentEvent } from "@earendil-works/pi-durable";

export type AuthMethodType = "api_key" | "oauth";
export type SessionStatus = "starting" | "idle" | "running" | "stopped" | "crashed";
export type MessageRole = "user" | "assistant" | "tool" | "meta";

/**
 * Pi's reasoning-effort levels. `off` is the absence of thinking rather than a level of it, which is
 * why it leads rather than trails. The array is here, not only the type, because a client has to
 * render the choices and the server has to validate against them.
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface WireUser {
  id: string;
  handle: string;
  createdAt: string;
}

/** An auth method as it appears on the wire: metadata only, never the credential. */
export interface WireAuthMethod {
  id: string;
  userId: string;
  type: AuthMethodType;
  provider: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface WireProject {
  id: string;
  ownerId: string;
  name: string;
  path: string;
  assignedAuthMethodId: string | null;
  /** The model a new session defaults to when the request does not name one. */
  defaultModel: WireModelRef | null;
  createdAt: string;
}

export interface WireModelRef {
  provider: string;
  modelId: string;
}

export interface WireSession {
  id: string;
  projectId: string;
  name: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  model: WireModelRef;
  /** How hard the model is asked to think before answering; `off` means it is not. */
  thinkingLevel: ThinkingLevel;
  conversationId: string | null;
  status: SessionStatus;
  pid: number | null;
  createdAt: string;
}

/** One mirrored transcript row. `content` is a JSON string holding a `MirrorContent`. */
export interface WireMessage {
  sessionId: string;
  sequence: number;
  entryId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

/**
 * The decoded form of `WireMessage.content`: the server's normalized, renderable payload. Kept in the
 * contract because every client has to decode it to display a transcript.
 */
export interface MirrorContent {
  text: string;
  thinking?: string;
  toolCalls?: { id: string; name: string; arguments: unknown }[];
  toolName?: string;
}

export interface WireContentEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export type WireContent =
  | { kind: "directory"; path: string; entries: WireContentEntry[] }
  | { kind: "file"; path: string; size: number; text: string };

/** One content match from a project search, with 1-based line and column. */
export interface WireSearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

/** One directory offered as a path suggestion; `git` marks a directory that is a repository root. */
export interface WireFsEntry {
  name: string;
  path: string;
  git: boolean;
}

export interface WireGitStatus {
  branch: string;
  dirty: string[];
  ahead: number;
  behind: number;
}

export interface WireGitCommit {
  sha: string;
  author: string;
  date: string;
  subject: string;
}

export interface WireGitWorktree {
  path: string;
  branch: string | null;
  head: string | null;
  detached: boolean;
}

/** The uniform error envelope. Every non-2xx response carries it. */
export interface WireError {
  error: { message: string };
}

/* The provider and model catalogue Pi knows about. */

/**
 * A provider with the auth it accepts. `apiKey` is null for an OAuth-only provider, and `oauth` is
 * null for one that accepts a key only — so a client can offer exactly what works.
 */
export interface WireProvider {
  id: string;
  name: string;
  baseUrl: string | null;
  /** How many chat models this provider offers; zero means there is nothing to choose. */
  modelCount: number;
  apiKey: { name: string } | null;
  oauth: { name: string } | null;
}

export interface WireModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/* Request bodies. */

export interface LoginRequest {
  handle: string;
  secret: string;
}

export interface CreateProjectRequest {
  path: string;
  name?: string;
}

export interface ApiKeyCredentialInput {
  type: "api_key";
  provider: string;
  label?: string;
  key: string;
}

export interface OAuthCredentialInput {
  type: "oauth";
  provider: string;
  label?: string;
  credential: { refresh: string; access: string; expires: number };
}

export type CreateAuthMethodRequest = ApiKeyCredentialInput | OAuthCredentialInput;

export interface AssignAuthMethodRequest {
  authMethodId: string | null;
}

export interface AssignDefaultModelRequest {
  model: WireModelRef | null;
}

export interface CreateSessionRequest {
  name: string;
  model?: WireModelRef;
  baseRef?: string;
}

/** Both fields are required: the settings dialog always knows what it is setting them to. */
export interface ConfigureSessionRequest {
  model: WireModelRef;
  thinkingLevel: ThinkingLevel;
}

export interface SubmitMessageRequest {
  /** Stable per submission. Repeating it is a no-op, which makes a retry safe. */
  requestId: string;
  text: string;
}

/* Response envelopes, one per route. */

export interface LoginResponse {
  token: string;
  user: WireUser;
}

export interface MeResponse {
  user: WireUser;
}

export interface CreateProjectResponse {
  project: WireProject;
}

export interface ListProjectsResponse {
  projects: WireProject[];
}

export interface ProjectResponse {
  project: WireProject;
}

export interface ContentResponse {
  content: WireContent;
}

/** `truncated` means the match cap stopped the search, so more matches may exist. */
export interface SearchResponse {
  matches: WireSearchMatch[];
  truncated: boolean;
}

/** The immediate subdirectories of a path, for the registration path autocomplete. */
export interface ListFsResponse {
  path: string;
  entries: WireFsEntry[];
}

export interface GitStatusResponse {
  status: WireGitStatus;
}

export interface GitLogResponse {
  commits: WireGitCommit[];
}

export interface GitWorktreesResponse {
  worktrees: WireGitWorktree[];
}

export interface CreateAuthMethodResponse {
  authMethod: WireAuthMethod;
}

export interface ListAuthMethodsResponse {
  authMethods: WireAuthMethod[];
}

export interface DeletedResponse {
  deleted: true;
}

export interface DeleteSessionResponse {
  deleted: true;
  /** Deletion always preserves the branch; this names the one that survived. */
  preservedBranch: string;
}

export interface CreateSessionResponse {
  session: WireSession;
}

export interface ListSessionsResponse {
  sessions: WireSession[];
}

export interface SessionResponse {
  session: WireSession;
}

export interface MessagesResponse {
  messages: WireMessage[];
}

export interface SubmitMessageResponse {
  submissionId: string;
}

export interface AbortedResponse {
  aborted: true;
}

/**
 * The worktree files a `@` mention completes against, relative to the worktree root and always
 * slash-separated. Fetched whole and filtered in the browser, so typing does not re-walk the tree.
 */
export interface ListSessionFilesResponse {
  files: string[];
  /** True when the server's cap stopped the walk, so the worktree holds more than this. */
  truncated: boolean;
}

export interface ListProvidersResponse {
  providers: WireProvider[];
}

export interface ListModelsResponse {
  models: WireModel[];
}

/* Event stream frames. */

/** Emitted on attach and on every status change, ahead of any other frame. */
export interface SessionStatusFrame {
  type: "session_status";
  status: SessionStatus;
}

/**
 * One frame of `GET /sessions/:id/events`. The server forwards Pi Durable's `AgentEvent`s opaquely —
 * the `snapshot` at attachment, then one batch per commit — so the source types are reused directly
 * rather than copied, which would drift.
 */
export type StreamFrame = SessionStatusFrame | AgentEvent;
