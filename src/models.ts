import type { CredentialStore, Models, MutableModels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

/**
 * Optional extra providers: `NEXUS_PROVIDERS_MODULE` names a module whose default export registers
 * providers on the collection. Used to run offline or in tests.
 *
 * Both the harness and the server's catalogue call this, so the catalogue can only ever offer
 * providers a harness would also have.
 */
export async function applyProvidersModule(models: MutableModels): Promise<void> {
  const modulePath = process.env.NEXUS_PROVIDERS_MODULE;
  if (modulePath === undefined || modulePath === "") return;
  // The module path is runtime-selected (plugin loading), so a static import cannot express it.
  const loaded: unknown = await import(modulePath);
  const register =
    loaded !== null && typeof loaded === "object" && "default" in loaded
      ? (loaded as { default: unknown }).default
      : undefined;
  if (typeof register !== "function") {
    throw new Error(`NEXUS_PROVIDERS_MODULE must default-export a function: ${modulePath}`);
  }
  await (register as (models: MutableModels) => unknown)(models);
}

/**
 * Build the provider collection, with any extra providers registered.
 *
 * Without a credential store the collection still lists providers and their models; it simply cannot
 * resolve auth, which is all the catalogue needs.
 */
export async function buildModels(credentials?: CredentialStore): Promise<Models> {
  const models = credentials === undefined ? builtinModels() : builtinModels({ credentials });
  await applyProvidersModule(models);
  return models;
}
