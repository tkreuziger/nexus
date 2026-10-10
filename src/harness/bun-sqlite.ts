import { Database, type Statement } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  SqliteDatabase,
  SqliteExecutor,
  SqliteValue,
} from "@earendil-works/pi-durable/storage/sqlite";

/** Shared statement cache and query helpers over one connection. */
class BunExecutor implements SqliteExecutor {
  readonly #statements = new Map<string, Statement>();

  constructor(protected readonly db: Database) {}

  #statement(sql: string): Statement {
    const cached = this.#statements.get(sql);
    if (cached !== undefined) return cached;
    const created = this.db.prepare(sql);
    this.#statements.set(sql, created);
    return created;
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async run(sql: string, ...params: SqliteValue[]): Promise<void> {
    this.#statement(sql).run(...(params as Parameters<Statement["run"]>));
  }

  async get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
    const row = this.#statement(sql).get(...(params as Parameters<Statement["get"]>));
    // Pi Durable's storage contract supplies the row shape for its own queries.
    return (row ?? undefined) as T | undefined;
  }

  async all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
    // Pi Durable's storage contract supplies the row shape for its own queries.
    return this.#statement(sql).all(...(params as Parameters<Statement["all"]>)) as T[];
  }
}

/**
 * `bun:sqlite` facade for Pi Durable's portable storage core, which cannot use `node:sqlite` on Bun
 * (ADR-4). Operations are serialized so a transaction never interleaves with unrelated work.
 */
class BunSqliteDatabase extends BunExecutor implements SqliteDatabase {
  #queue: Promise<unknown> = Promise.resolve();
  #closed = false;

  constructor(db: Database) {
    super(db);
  }

  #enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  override exec(sql: string): Promise<void> {
    return this.#enqueue(() => super.exec(sql));
  }

  override run(sql: string, ...params: SqliteValue[]): Promise<void> {
    return this.#enqueue(() => super.run(sql, ...params));
  }

  override get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
    return this.#enqueue(() => super.get<T>(sql, ...params));
  }

  override all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
    return this.#enqueue(() => super.all<T>(sql, ...params));
  }

  transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
    return this.#enqueue(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const result = await callback(new BunExecutor(this.db));
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          throw new AggregateError([error], "rollback failed");
        }
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    await this.#enqueue(() => {
      if (this.#closed) return;
      this.#closed = true;
      this.db.close();
    });
  }
}

/** Open a WAL-mode SQLite database wrapped for Pi Durable's storage core. */
export function openBunSqliteDatabase(path: string): SqliteDatabase {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
  return new BunSqliteDatabase(db);
}
