import { describe, expect, test } from "bun:test";
import { KeyedLock } from "../../src/sessions/locks.ts";

const tick = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
};

describe("KeyedLock", () => {
  test("never interleaves two operations on the same key", async () => {
    const lock = new KeyedLock();
    const order: string[] = [];
    const first = lock.run("project", async () => {
      order.push("first:start");
      await tick();
      await tick();
      order.push("first:end");
    });
    const second = lock.run("project", async () => {
      order.push("second:start");
      order.push("second:end");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  test("runs different keys concurrently", async () => {
    const lock = new KeyedLock();
    const order: string[] = [];
    const release = Promise.withResolvers<void>();
    const first = lock.run("a", async () => {
      order.push("a:start");
      await release.promise;
      order.push("a:end");
    });
    const second = lock.run("b", async () => {
      order.push("b:start");
    });
    await second;
    expect(order).toEqual(["a:start", "b:start"]);
    release.resolve();
    await first;
  });

  test("keeps working after an operation rejects", async () => {
    const lock = new KeyedLock();
    const failed = lock.run("project", async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    expect(await lock.run("project", async () => "recovered")).toBe("recovered");
  });
});
