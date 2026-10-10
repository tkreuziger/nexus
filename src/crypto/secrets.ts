import { constants } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_VERSION = "v1";

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));

async function importKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Load the AES-256 key at `path`, generating and persisting one with 0600 permissions if absent. */
export async function loadOrCreateKey(path: string): Promise<CryptoKey> {
  const existing = await readFile(path).catch(() => undefined);
  if (existing !== undefined) {
    if (existing.byteLength !== KEY_BYTES) {
      throw new Error(`secret key at ${path} is not ${KEY_BYTES} bytes`);
    }
    return importKey(new Uint8Array(existing));
  }
  const raw = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  await writeFile(path, raw, { mode: constants.S_IRUSR | constants.S_IWUSR });
  await chmod(path, 0o600);
  return importKey(raw);
}

/** Encrypt `plaintext` into a versioned `v1.<iv>.<tag>.<ciphertext>` envelope. */
export async function encryptSecret(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  const ciphertext = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  return [ENVELOPE_VERSION, toBase64(iv), toBase64(tag), toBase64(ciphertext)].join(".");
}

/** Decrypt an envelope produced by {@link encryptSecret}. Throws on malformed input or authentication failure. */
export async function decryptSecret(key: CryptoKey, envelope: string): Promise<string> {
  const [version, ivPart, tagPart, ciphertextPart] = envelope.split(".");
  if (
    version !== ENVELOPE_VERSION ||
    ivPart === undefined ||
    tagPart === undefined ||
    ciphertextPart === undefined
  ) {
    throw new Error("malformed secret envelope");
  }
  const iv = fromBase64(ivPart);
  const tag = fromBase64(tagPart);
  const ciphertext = fromBase64(ciphertextPart);
  if (iv.byteLength !== IV_BYTES || tag.byteLength !== TAG_BYTES) {
    throw new Error("malformed secret envelope");
  }
  const sealed = new Uint8Array(ciphertext.byteLength + tag.byteLength);
  sealed.set(ciphertext, 0);
  sealed.set(tag, ciphertext.byteLength);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, sealed);
  return new TextDecoder().decode(plaintext);
}
