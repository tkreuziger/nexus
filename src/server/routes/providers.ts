import type { ListModelsResponse, ListProvidersResponse } from "@nexus/client";
import type { ModelCatalog } from "../../catalog.ts";
import { HttpError } from "../../errors.ts";
import type { Route } from "../contract.ts";
import { jsonResponse } from "../json.ts";

export interface CatalogDeps {
  catalog: ModelCatalog;
}

/** Read-only catalogue routes: the providers Pi knows, and the models each one offers (§3.1). */
export function providerRoutes(deps: CatalogDeps): readonly Route[] {
  return [
    {
      method: "GET",
      path: "/providers",
      handler: async () =>
        jsonResponse<ListProvidersResponse>({ providers: [...(await deps.catalog.providers())] }),
    },
    {
      method: "GET",
      path: "/providers/:id/models",
      handler: async (scope) => {
        const id = scope.params.id ?? "";
        if ((await deps.catalog.provider(id)) === undefined) {
          throw new HttpError(404, `no such provider: ${id}`);
        }
        return jsonResponse<ListModelsResponse>({ models: [...(await deps.catalog.models(id))] });
      },
    },
  ];
}
