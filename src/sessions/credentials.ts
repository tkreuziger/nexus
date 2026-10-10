import type { Database } from "bun:sqlite";
import { isCredential } from "../credentials.ts";
import { decryptSecret, encryptSecret } from "../crypto/secrets.ts";
import { asCredentialModifyParams, asCredentialReadParams } from "../protocol/guards.ts";
import type { CredentialListResult, CredentialResult } from "../protocol/messages.ts";
import {
  getAuthMethod,
  touchAuthMethod,
  updateAuthMethodCredential,
} from "../store/auth-methods.ts";
import { getProjectById } from "../store/projects.ts";
import type { AuthMethod, Session } from "../types.ts";

export interface CredentialDeps {
  db: Database;
  secretKey: CryptoKey;
}

/** Handlers the server answers for a harness process's `CredentialStore` (ADR-2). */
export interface CredentialHandlers {
  read(params: unknown): Promise<CredentialResult>;
  list(params: unknown): Promise<CredentialListResult>;
  modify(params: unknown): Promise<CredentialResult>;
  delete(params: unknown): Promise<CredentialResult>;
}

/**
 * Build the credential handlers for one session. The project's assigned auth method is the only
 * credential this session may see; plaintext never leaves this process.
 */
export function credentialHandlers(session: Session, deps: CredentialDeps): CredentialHandlers {
  const assigned = (): AuthMethod | undefined => {
    const project = getProjectById(deps.db, session.projectId);
    const id = project?.assignedAuthMethodId ?? null;
    return id === null ? undefined : getAuthMethod(deps.db, id);
  };
  const matching = (provider: string): AuthMethod | undefined => {
    const method = assigned();
    return method !== undefined && method.provider === provider ? method : undefined;
  };
  return {
    async read(params) {
      const method = matching(asCredentialReadParams(params).provider);
      if (method === undefined) return { credential: null };
      const plaintext = await decryptSecret(deps.secretKey, method.credentialCiphertext);
      const parsed: unknown = JSON.parse(plaintext);
      if (!isCredential(parsed)) throw new Error("stored credential is not a valid credential");
      touchAuthMethod(deps.db, method.id);
      return { credential: parsed };
    },
    async list() {
      const method = assigned();
      return {
        infos: method === undefined ? [] : [{ providerId: method.provider, type: method.type }],
      };
    },
    async modify(params) {
      const { provider, credential } = asCredentialModifyParams(params);
      const method = matching(provider);
      if (method === undefined || credential === null) return { credential: null };
      const ciphertext = await encryptSecret(deps.secretKey, JSON.stringify(credential));
      updateAuthMethodCredential(deps.db, method.id, ciphertext);
      return { credential };
    },
    async delete() {
      return { credential: null };
    },
  };
}
