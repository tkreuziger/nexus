import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBunSqliteDatabase } from "../../src/harness/bun-sqlite.ts";

const freshDb = () => {
  const db = openBunSqliteDatabase(join(mkdtempSync(join(tmpdir(), "nexus-sqlite-")), "s.sqlite"));
  return db;
};

describe("bun:sqlite facade", () => {
  test("commits a transaction", async () => {
    const db = freshDb();
    await db.exec("CREATE TABLE t (v TEXT)");
    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO t (v) VALUES (?)", "committed");
    });
    expect(await db.all<{ v: string }>("SELECT v FROM t")).toEqual([{ v: "committed" }]);
    await db.close();
  });

  test("rolls back and rethrows the callback error", async () => {
    const db = freshDb();
    await db.exec("CREATE TABLE t (v TEXT)");
    const failure = new Error("callback failed");
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO t (v) VALUES (?)", "discarded");
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await db.all<{ v: string }>("SELECT v FROM t")).toEqual([]);
    await db.close();
  });

  test("keeps unrelated reads out of an open transaction", async () => {
    const db = freshDb();
    await db.exec("CREATE TABLE t (v TEXT)");
    const inside = Promise.withResolvers<void>();
    const proceed = Promise.withResolvers<void>();
    const transaction = db.transaction(async (tx) => {
      await tx.run("INSERT INTO t (v) VALUES (?)", "uncommitted");
      inside.resolve();
      await proceed.promise;
    });
    await inside.promise;
    const concurrentRead = db.all<{ v: string }>("SELECT v FROM t");
    proceed.resolve();
    await transaction;
    expect(await concurrentRead).toEqual([{ v: "uncommitted" }]);
    await db.close();
  });

  test("reports a get miss as undefined", async () => {
    const db = freshDb();
    await db.exec("CREATE TABLE t (v TEXT)");
    expect(await db.get<{ v: string }>("SELECT v FROM t WHERE v = ?", "absent")).toBeUndefined();
    await db.close();
  });

  test("refuses work after close", async () => {
    const db = freshDb();
    await db.exec("CREATE TABLE t (v TEXT)");
    await db.close();
    await expect(db.all("SELECT v FROM t")).rejects.toThrow();
  });
});
