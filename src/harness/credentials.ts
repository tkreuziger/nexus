import type { CredentialStore } from "@earendil-works/pi-ai";
import {
  type CredentialListResult,
  type CredentialResult,
  HARNESS_METHODS,
} from "../protocol/messages.ts";
import type { JsonRpc } from "../protocol/rpc.ts";

/**
 * Credential store that proxies to the server (ADR-2). The server owns the ciphertext and the write
 * path, so an OAuth refresh performed inside `modify` is persisted and survives a harness restart.
 */
export function createProxyCredentialStore(rpc: JsonRpc): CredentialStore {
  const read = async (provider: string) => {
    const result = await rpc.request<CredentialResult>(HARNESS_METHODS.credentialRead, {
      provider,
    });
    return result.credential ?? undefined;
  };
  return {
    read: (providerId) => read(providerId),
    async list() {
      const result = await rpc.request<CredentialListResult>(HARNESS_METHODS.credentialList, {});
      return result.infos;
    },
    async modify(providerId, fn) {
      const current = await read(providerId);
      const next = await fn(current);
      if (next === undefined) return current;
      const result = await rpc.request<CredentialResult>(HARNESS_METHODS.credentialModify, {
        provider: providerId,
        credential: next,
      });
      return result.credential ?? undefined;
    },
    async delete(providerId) {
      await rpc.request(HARNESS_METHODS.credentialDelete, { provider: providerId });
    },
  };
}
