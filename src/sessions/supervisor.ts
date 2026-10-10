import type { Database } from "bun:sqlite";
import { type ChildProcess, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { HttpError } from "../errors.ts";
import {
  asEntryParams,
  asEventParams,
  asFaultParams,
  asReadyParams,
  asStatusParams,
} from "../protocol/guards.ts";
import { HARNESS_METHODS } from "../protocol/messages.ts";
import { appendMirrorEntry, findRequest, recordRequest } from "../store/messages.ts";
import { getProjectById } from "../store/projects.ts";
import {
  deleteSession,
  getSession,
  type InsertSessionInput,
  insertSession,
  listLiveSessions,
  listSessions,
  setSessionConversation,
  setSessionStatus,
} from "../store/sessions.ts";
import type { ModelRef, Project, ProjectId, Session, SessionId } from "../types.ts";
import { credentialHandlers } from "./credentials.ts";
import { SessionHub } from "./hub.ts";
import { childChannel, HarnessClient } from "./ipc.ts";
import { KeyedLock } from "./locks.ts";
import { toMirrorMapping } from "./mirror.ts";
import { createWorktree, removeWorktree, worktreePathFor } from "./worktree.ts";

const HARNESS_ENTRY = join(import.meta.dir, "..", "harness", "main.ts");

interface Running {
  client: HarnessClient;
  child: ChildProcess;
  hub: SessionHub;
  stopping: boolean;
}

export interface CreateSessionInput {
  name: string;
  model: ModelRef;
  baseRef: string;
}

/** Owns the harness processes: spawn, track, restart, stop, and the status each session reports. */
export class SessionSupervisor {
  readonly #running = new Map<SessionId, Running>();
  /** Serializes worktree creation and removal per project (§7). */
  readonly #locks = new KeyedLock();

  constructor(
    private readonly db: Database,
    private readonly config: Config,
    private readonly secretKey: CryptoKey,
  ) {}

  list(projectId: ProjectId): Session[] {
    return listSessions(this.db, projectId);
  }

  get(id: SessionId): Session | undefined {
    return getSession(this.db, id);
  }

  hub(id: SessionId): SessionHub | undefined {
    return this.#running.get(id)?.hub;
  }

  /** Mark sessions left live by a previous server process as crashed; their worktrees stay. */
  reconcile(): void {
    for (const session of listLiveSessions(this.db)) {
      setSessionStatus(this.db, session.id, "crashed", null);
    }
  }

  async create(project: Project, input: CreateSessionInput): Promise<Session> {
    const id = crypto.randomUUID() as SessionId;
    const worktreePath = worktreePathFor(this.config.worktreesRoot, project.name, id);
    const session = this.#insert({
      id,
      projectId: project.id,
      name: input.name,
      worktreePath,
      branch: `pi/${input.name}`,
      baseRef: input.baseRef,
      model: input.model,
    });
    try {
      // Serialized per project: concurrent `git worktree add` calls on one repository race.
      await this.#locks.run(project.id, () =>
        createWorktree({
          projectPath: project.path,
          projectName: project.name,
          sessionId: id,
          sessionName: input.name,
          baseRef: input.baseRef,
          root: this.config.worktreesRoot,
        }),
      );
    } catch (error) {
      deleteSession(this.db, id);
      throw error;
    }
    await this.start(session);
    return this.get(id) ?? session;
  }

  #insert(input: InsertSessionInput): Session {
    try {
      return insertSession(this.db, input);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new HttpError(409, `a session named "${input.name}" already exists in this project`);
      }
      throw error;
    }
  }

  async start(session: Session): Promise<void> {
    if (this.#running.has(session.id)) return;
    const hub = new SessionHub("starting");
    const child = spawn(process.execPath, [HARNESS_ENTRY], {
      cwd: session.worktreePath,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const client = new HarnessClient(childChannel(child));
    const running: Running = { client, child, hub, stopping: false };
    this.#running.set(session.id, running);
    setSessionStatus(this.db, session.id, "starting", child.pid ?? null);
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[harness ${session.id.slice(0, 8)}] ${chunk.toString()}`);
    });
    this.#wire(session, running);
    client.start();
    const project = getProjectById(this.db, session.projectId);
    const ready = await client.init({
      sessionId: session.id,
      cwd: session.worktreePath,
      dbPath: join(this.config.piStorageDir, `${session.id}.sqlite`),
      model: session.model,
      authMethodId: project?.assignedAuthMethodId ?? null,
      compaction: this.config.compaction,
    });
    setSessionConversation(this.db, session.id, ready.conversationId);
    setSessionStatus(this.db, session.id, "idle", child.pid ?? null);
    hub.status = "idle";
  }

  async submit(id: SessionId, input: { requestId: string; text: string }): Promise<string> {
    const already = findRequest(this.db, id, input.requestId);
    if (already !== undefined) return already;
    const running = this.#running.get(id);
    if (running === undefined) throw new HttpError(409, "session is not running");
    const result = await running.client.submit(input);
    recordRequest(this.db, id, input.requestId, result.submissionId);
    return result.submissionId;
  }

  async abort(id: SessionId): Promise<void> {
    const running = this.#running.get(id);
    if (running === undefined) throw new HttpError(409, "session is not running");
    await running.client.abort();
  }

  /**
   * Attach one client's event stream. Each subscription gets its own Pi Durable attachment, so the
   * snapshot and the registration are captured together and nothing is lost or replayed (§3.4).
   */
  async subscribe(
    id: SessionId,
    onEvents: (events: readonly unknown[]) => void,
  ): Promise<{ release: () => void }> {
    const running = this.#running.get(id);
    if (running === undefined) throw new HttpError(409, "session is not running");
    const subscriptionId = crypto.randomUUID();
    running.hub.addSubscription(subscriptionId, onEvents);
    try {
      await running.client.subscribe(subscriptionId);
    } catch (error) {
      running.hub.removeSubscription(subscriptionId);
      throw error;
    }
    return {
      release: () => {
        running.hub.removeSubscription(subscriptionId);
        void running.client.unsubscribe(subscriptionId).catch(() => undefined);
      },
    };
  }

  /** Stop the harness process. The conversation and its storage stay on disk for a later restart. */
  async stop(id: SessionId): Promise<void> {
    const running = this.#running.get(id);
    if (running === undefined) return;
    running.stopping = true;
    await running.client.shutdown().catch(() => undefined);
    running.client.close();
    running.child.kill();
    this.#running.delete(id);
    setSessionStatus(this.db, id, "stopped", null);
  }

  /** Start the process again; Pi Durable resumes any run the previous process left unfinished. */
  async restart(id: SessionId): Promise<void> {
    const session = this.get(id);
    if (session === undefined) throw new HttpError(404, `no such session: ${id}`);
    await this.stop(id);
    await this.start(session);
  }

  /**
   * Delete a session: stop the process, remove its worktree, and drop its stored data. The branch is
   * preserved (ADR-7), and a worktree holding uncommitted work is refused unless `force` is set.
   */
  async remove(id: SessionId, options: { force?: boolean } = {}): Promise<void> {
    const session = this.get(id);
    if (session === undefined) throw new HttpError(404, `no such session: ${id}`);
    const project = getProjectById(this.db, session.projectId);
    await this.stop(id);
    if (project !== undefined) {
      await this.#locks.run(project.id, () =>
        removeWorktree(project.path, session.worktreePath, options),
      );
    }
    deleteSession(this.db, id);
    await rm(join(this.config.piStorageDir, `${id}.sqlite`), { force: true });
    await rm(join(this.config.piStorageDir, `${id}.sqlite-wal`), { force: true });
    await rm(join(this.config.piStorageDir, `${id}.sqlite-shm`), { force: true });
  }

  #wire(session: Session, running: Running): void {
    const { client, hub } = running;
    client.rpc.onNotification(HARNESS_METHODS.ready, (params) => {
      setSessionConversation(this.db, session.id, asReadyParams(params).conversationId);
    });
    client.rpc.onNotification(HARNESS_METHODS.status, (params) => {
      const { status } = asStatusParams(params);
      hub.status = status;
      setSessionStatus(this.db, session.id, status, running.child.pid ?? null);
    });
    client.rpc.onNotification(HARNESS_METHODS.event, (params) => {
      const { subscriptionId, events } = asEventParams(params);
      hub.publish(subscriptionId, events);
    });
    client.rpc.onNotification(HARNESS_METHODS.entry, (params) => {
      const mapping = toMirrorMapping(asEntryParams(params).entry);
      if (mapping !== undefined) appendMirrorEntry(this.db, { sessionId: session.id, ...mapping });
    });
    client.rpc.onNotification(HARNESS_METHODS.fault, (params) => {
      console.error(`[harness ${session.id.slice(0, 8)}] fault: ${asFaultParams(params).message}`);
    });
    const credentials = credentialHandlers(session, { db: this.db, secretKey: this.secretKey });
    client.rpc.onRequest(HARNESS_METHODS.credentialRead, credentials.read);
    client.rpc.onRequest(HARNESS_METHODS.credentialList, credentials.list);
    client.rpc.onRequest(HARNESS_METHODS.credentialModify, credentials.modify);
    client.rpc.onRequest(HARNESS_METHODS.credentialDelete, credentials.delete);
    client.rpc.onClose(() => this.#markCrashed(session.id, running));
    running.child.on("exit", () => this.#markCrashed(session.id, running));
  }

  #markCrashed(id: SessionId, running: Running): void {
    if (running.stopping) return;
    if (this.#running.get(id) !== running) return;
    this.#running.delete(id);
    running.hub.status = "crashed";
    setSessionStatus(this.db, id, "crashed", null);
  }
}
