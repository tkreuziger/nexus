import { errorFromResponse } from "./errors.ts";
import { defaultFetch, type FetchLike } from "./fetch.ts";
import { API_PREFIX } from "./prefix.ts";
import { SessionStream, type SessionStreamOptions } from "./stream.ts";
import type * as wire from "./wire.ts";

export interface ApiClientOptions {
  /** Prefix for every request. Defaults to the server's API prefix, which is the same in every environment. */
  baseUrl?: string;
  token?: string | null;
  /** Injectable for tests. */
  fetch?: FetchLike;
}

/** Per-call options for the read routes; writes are short-lived and are not cancellable. */
export interface RequestOptions {
  signal?: AbortSignal;
}

/**
 * One typed method per route. The bearer token is held here rather than passed per call, so a 401 can
 * be handled in one place by clearing it.
 */
export class ApiClient {
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  #token: string | null;

  constructor(options: ApiClientOptions = {}) {
    this.#baseUrl = options.baseUrl ?? API_PREFIX;
    this.#fetch = options.fetch ?? defaultFetch;
    this.#token = options.token ?? null;
  }

  get baseUrl(): string {
    return this.#baseUrl;
  }

  get token(): string | null {
    return this.#token;
  }

  setToken(token: string | null): void {
    this.#token = token;
  }

  async #request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    options: { body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.#token !== null) headers.authorization = `Bearer ${this.#token}`;
    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    if (options.signal !== undefined) init.signal = options.signal;

    const response = await this.#fetch(`${this.#baseUrl}${path}`, init);
    if (!response.ok) throw await errorFromResponse(response);
    return (await response.json()) as T;
  }

  /* Identity. */

  login(body: wire.LoginRequest): Promise<wire.LoginResponse> {
    return this.#request("POST", "/login", { body });
  }

  me(options: RequestOptions = {}): Promise<wire.MeResponse> {
    return this.#request("GET", "/me", options);
  }

  /* The provider and model catalogue. */

  listProviders(options: RequestOptions = {}): Promise<wire.ListProvidersResponse> {
    return this.#request("GET", "/providers", options);
  }

  listProviderModels(
    providerId: string,
    options: RequestOptions = {},
  ): Promise<wire.ListModelsResponse> {
    return this.#request("GET", `/providers/${encodeURIComponent(providerId)}/models`, options);
  }

  /* Projects. */

  listProjects(options: RequestOptions = {}): Promise<wire.ListProjectsResponse> {
    return this.#request("GET", "/projects", options);
  }

  createProject(body: wire.CreateProjectRequest): Promise<wire.CreateProjectResponse> {
    return this.#request("POST", "/projects", { body });
  }

  getProject(id: string, options: RequestOptions = {}): Promise<wire.ProjectResponse> {
    return this.#request("GET", `/projects/${encodeURIComponent(id)}`, options);
  }

  getProjectContent(
    id: string,
    path = "",
    options: RequestOptions = {},
  ): Promise<wire.ContentResponse> {
    const query = new URLSearchParams({ path });
    return this.#request("GET", `/projects/${encodeURIComponent(id)}/content?${query}`, options);
  }

  searchProject(
    id: string,
    query: string,
    limit?: number,
    options: RequestOptions = {},
  ): Promise<wire.SearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (limit !== undefined) params.set("limit", String(limit));
    return this.#request("GET", `/projects/${encodeURIComponent(id)}/search?${params}`, options);
  }

  /** Immediate subdirectories of `path` (the server's home directory when empty), for autocomplete. */
  listFs(path = "", options: RequestOptions = {}): Promise<wire.ListFsResponse> {
    return this.#request("GET", `/fs/list?${new URLSearchParams({ path })}`, options);
  }

  getGitStatus(id: string, options: RequestOptions = {}): Promise<wire.GitStatusResponse> {
    return this.#request("GET", `/projects/${encodeURIComponent(id)}/git/status`, options);
  }

  getGitLog(
    id: string,
    limit?: number,
    options: RequestOptions = {},
  ): Promise<wire.GitLogResponse> {
    const query = limit === undefined ? "" : `?${new URLSearchParams({ limit: String(limit) })}`;
    return this.#request("GET", `/projects/${encodeURIComponent(id)}/git/log${query}`, options);
  }

  getGitWorktrees(id: string, options: RequestOptions = {}): Promise<wire.GitWorktreesResponse> {
    return this.#request("GET", `/projects/${encodeURIComponent(id)}/git/worktrees`, options);
  }

  assignAuthMethod(projectId: string, authMethodId: string | null): Promise<wire.ProjectResponse> {
    const body: wire.AssignAuthMethodRequest = { authMethodId };
    return this.#request("PUT", `/projects/${encodeURIComponent(projectId)}/auth-method`, { body });
  }

  /* Auth methods. */

  listAuthMethods(options: RequestOptions = {}): Promise<wire.ListAuthMethodsResponse> {
    return this.#request("GET", "/auth-methods", options);
  }

  createAuthMethod(body: wire.CreateAuthMethodRequest): Promise<wire.CreateAuthMethodResponse> {
    return this.#request("POST", "/auth-methods", { body });
  }

  deleteAuthMethod(id: string): Promise<wire.DeletedResponse> {
    return this.#request("DELETE", `/auth-methods/${encodeURIComponent(id)}`);
  }

  /* Sessions. */

  createSession(
    projectId: string,
    body: wire.CreateSessionRequest,
  ): Promise<wire.CreateSessionResponse> {
    return this.#request("POST", `/projects/${encodeURIComponent(projectId)}/sessions`, { body });
  }

  listSessions(
    projectId: string,
    options: RequestOptions = {},
  ): Promise<wire.ListSessionsResponse> {
    return this.#request("GET", `/projects/${encodeURIComponent(projectId)}/sessions`, options);
  }

  getSession(id: string, options: RequestOptions = {}): Promise<wire.SessionResponse> {
    return this.#request("GET", `/sessions/${encodeURIComponent(id)}`, options);
  }

  restartSession(id: string): Promise<wire.SessionResponse> {
    return this.#request("POST", `/sessions/${encodeURIComponent(id)}/restart`);
  }

  deleteSession(
    id: string,
    options: { force?: boolean } = {},
  ): Promise<wire.DeleteSessionResponse> {
    const query = options.force === true ? "?force=true" : "";
    return this.#request("DELETE", `/sessions/${encodeURIComponent(id)}${query}`);
  }

  submitMessage(id: string, body: wire.SubmitMessageRequest): Promise<wire.SubmitMessageResponse> {
    return this.#request("POST", `/sessions/${encodeURIComponent(id)}/messages`, { body });
  }

  listMessages(
    id: string,
    limit?: number,
    options: RequestOptions = {},
  ): Promise<wire.MessagesResponse> {
    const query = limit === undefined ? "" : `?${new URLSearchParams({ limit: String(limit) })}`;
    return this.#request("GET", `/sessions/${encodeURIComponent(id)}/messages${query}`, options);
  }

  abortSession(id: string): Promise<wire.AbortedResponse> {
    return this.#request("POST", `/sessions/${encodeURIComponent(id)}/abort`);
  }

  /** Open a self-healing event stream for a session, carrying this client's token. */
  openStream(
    sessionId: string,
    options: Omit<SessionStreamOptions, "baseUrl" | "token" | "fetch">,
  ): SessionStream {
    return new SessionStream(sessionId, {
      ...options,
      baseUrl: this.#baseUrl,
      token: this.#token,
      fetch: this.#fetch,
    });
  }
}
