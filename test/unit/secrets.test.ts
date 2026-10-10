import { describe, expect, test } from "bun:test";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decryptSecret, encryptSecret, loadOrCreateKey } from "../../src/crypto/secrets.ts";

const keyPath = () => join(mkdtempSync(join(tmpdir(), "nexus-key-")), "secret.key");

describe("secret encryption", () => {
  test("round-trips plaintext", async () => {
    const key = await loadOrCreateKey(keyPath());
    const envelope = await encryptSecret(key, "sk-fake-placeholder");
    expect(await decryptSecret(key, envelope)).toBe("sk-fake-placeholder");
  });

  test("ciphertext does not contain the plaintext", async () => {
    const key = await loadOrCreateKey(keyPath());
    const envelope = await encryptSecret(key, "super-secret-value");
    expect(envelope).not.toContain("super-secret-value");
  });

  test("same plaintext encrypts to different envelopes", async () => {
    const key = await loadOrCreateKey(keyPath());
    const first = await encryptSecret(key, "same");
    const second = await encryptSecret(key, "same");
    expect(first).not.toBe(second);
  });

  test("envelope is versioned with four dot-separated parts", async () => {
    const key = await loadOrCreateKey(keyPath());
    const envelope = await encryptSecret(key, "x");
    const parts = envelope.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  test("rejects a tampered ciphertext", async () => {
    const key = await loadOrCreateKey(keyPath());
    const envelope = await encryptSecret(key, "tamper-me");
    const parts = envelope.split(".");
    const flipped = Buffer.from(parts[3] as string, "base64");
    flipped[0] = (flipped[0] as number) ^ 0xff;
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${flipped.toString("base64")}`;
    await expect(decryptSecret(key, tampered)).rejects.toThrow();
  });

  test("rejects a different key", async () => {
    const envelope = await encryptSecret(await loadOrCreateKey(keyPath()), "mine");
    const other = await loadOrCreateKey(keyPath());
    await expect(decryptSecret(other, envelope)).rejects.toThrow();
  });

  test("rejects a malformed envelope", async () => {
    const key = await loadOrCreateKey(keyPath());
    await expect(decryptSecret(key, "not-an-envelope")).rejects.toThrow();
  });

  test("writes the key file with 0600 permissions", async () => {
    const path = keyPath();
    await loadOrCreateKey(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("reuses an existing key file", async () => {
    const path = keyPath();
    const first = await loadOrCreateKey(path);
    const second = await loadOrCreateKey(path);
    const envelope = await encryptSecret(first, "persisted");
    expect(await decryptSecret(second, envelope)).toBe("persisted");
  });
});
