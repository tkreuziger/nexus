import type { Database } from "bun:sqlite";
import type {
  CreateAuthMethodResponse,
  DeletedResponse,
  ListAuthMethodsResponse,
  ProjectResponse,
  WireAuthMethod,
} from "@nexus/client";
import { parseCredentialInput } from "../../credentials.ts";
import { encryptSecret } from "../../crypto/secrets.ts";
import { HttpError } from "../../errors.ts";
import { requireProject } from "../../projects/registry.ts";
import {
  assignAuthMethod,
  deleteAuthMethod,
  getAuthMethod,
  insertAuthMethod,
  listAuthMethods,
} from "../../store/auth-methods.ts";
import type { AuthMethod, AuthMethodId, AuthMethodType, ProjectId } from "../../types.ts";
import type { RequestScope, Route } from "../contract.ts";
import { jsonResponse, optionalString, readJsonObject, requiredString } from "../json.ts";

export interface AuthDeps {
  db: Database;
  secretKey: CryptoKey;
}

/** Strip the credential: the wire contract never carries secret material. */
const publicView = (method: AuthMethod): WireAuthMethod => ({
  id: method.id,
  userId: method.userId,
  type: method.type,
  provider: method.provider,
  label: method.label,
  createdAt: method.createdAt,
  lastUsedAt: method.lastUsedAt,
});

/** Resolve an auth method the caller owns, or throw 404 without revealing that it exists. */
function requireOwnedMethod(scope: RequestScope, id: AuthMethodId): AuthMethod {
  const method = getAuthMethod(scope.db, id);
  if (method === undefined || method.userId !== scope.user.id) {
    throw new HttpError(404, `no such auth method: ${id}`);
  }
  return method;
}

const authMethodIdOf = (body: Record<string, unknown>): AuthMethodId | null => {
  const value = body.authMethodId;
  if (value === null) return null;
  if (typeof value !== "string" || value === "") {
    throw new HttpError(400, '"authMethodId" must be a string or null');
  }
  return value as AuthMethodId;
};

/** Auth-method routes: store a credential encrypted at rest and assign one to a project (§3.1). */
export function authMethodRoutes(deps: AuthDeps): readonly Route[] {
  return [
    {
      method: "POST",
      path: "/auth-methods",
      handler: async (scope, request) => {
        const body = await readJsonObject(request);
        const credential = parseCredentialInput(body);
        const type = credential.type as AuthMethodType;
        const method = insertAuthMethod(scope.db, {
          userId: scope.user.id,
          type,
          provider: requiredString(body, "provider"),
          label: optionalString(body, "label") ?? requiredString(body, "provider"),
          credentialCiphertext: await encryptSecret(deps.secretKey, JSON.stringify(credential)),
        });
        return jsonResponse<CreateAuthMethodResponse>({ authMethod: publicView(method) }, 201);
      },
    },
    {
      method: "GET",
      path: "/auth-methods",
      handler: (scope) =>
        jsonResponse<ListAuthMethodsResponse>({
          authMethods: listAuthMethods(scope.db, scope.user.id).map(publicView),
        }),
    },
    {
      method: "DELETE",
      path: "/auth-methods/:id",
      handler: (scope) => {
        const method = requireOwnedMethod(scope, scope.params.id as AuthMethodId);
        deleteAuthMethod(scope.db, method.id);
        return jsonResponse<DeletedResponse>({ deleted: true });
      },
    },
    {
      method: "PUT",
      path: "/projects/:id/auth-method",
      handler: async (scope, request) => {
        const project = requireProject(scope.db, scope.params.id as ProjectId, scope.user.id);
        const requested = authMethodIdOf(await readJsonObject(request));
        if (requested !== null) requireOwnedMethod(scope, requested);
        assignAuthMethod(scope.db, project.id, requested);
        return jsonResponse<ProjectResponse>({
          project: requireProject(scope.db, project.id, scope.user.id),
        });
      },
    },
  ];
}
