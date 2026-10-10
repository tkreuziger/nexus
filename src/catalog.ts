import type { AuthType, Models } from "@earendil-works/pi-ai";
import { buildModels } from "./models.ts";

/** A provider as the API presents it: identity, catalogue size, and which auth it accepts. */
export interface ProviderSummary {
  id: string;
  name: string;
  baseUrl: string | null;
  modelCount: number;
  /** Present when a key can be used for this provider. Absent for OAuth-only providers. */
  apiKey: { name: string } | null;
  oauth: { name: string } | null;
}

export interface ModelSummary {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/**
 * The provider and model catalogue Pi knows about, built from the same collection a harness uses.
 *
 * That shared origin is the point: a provider or model the catalogue does not list is one a harness
 * could not resolve either, so validating against this turns a session that would fail at its first
 * request into an immediate, specific error.
 */
export class ModelCatalog {
  #loading: Promise<Models> | undefined;
  #providers: Promise<readonly ProviderSummary[]> | undefined;
  readonly #models = new Map<string, Promise<readonly ModelSummary[]>>();

  /** Build the collection now, so a broken provider module fails at boot rather than on a request. */
  async load(): Promise<void> {
    await this.collection();
  }

  collection(): Promise<Models> {
    this.#loading ??= buildModels();
    return this.#loading;
  }

  async providers(): Promise<readonly ProviderSummary[]> {
    this.#providers ??= this.#buildProviders();
    return this.#providers;
  }

  async models(providerId: string): Promise<readonly ModelSummary[]> {
    const cached = this.#models.get(providerId);
    if (cached !== undefined) return cached;
    const loading = this.#buildModels(providerId);
    this.#models.set(providerId, loading);
    return loading;
  }

  /** The provider's summary, or `undefined` when Pi does not know it. */
  async provider(providerId: string): Promise<ProviderSummary | undefined> {
    return (await this.providers()).find((provider) => provider.id === providerId);
  }

  /** Whether the provider is known and accepts this kind of auth. */
  async supports(providerId: string, type: AuthType): Promise<boolean> {
    const provider = await this.provider(providerId);
    if (provider === undefined) return false;
    return type === "api_key" ? provider.apiKey !== null : provider.oauth !== null;
  }

  /** The model, or `undefined` when the provider is unknown or does not offer it. */
  async model(providerId: string, modelId: string): Promise<ModelSummary | undefined> {
    return (await this.models(providerId)).find((model) => model.id === modelId);
  }

  async #buildProviders(): Promise<readonly ProviderSummary[]> {
    const models = await this.collection();
    return models
      .getProviders()
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl ?? null,
        modelCount: models.getModels(provider.id).length,
        apiKey: provider.auth.apiKey === undefined ? null : { name: provider.auth.apiKey.name },
        oauth: provider.auth.oauth === undefined ? null : { name: provider.auth.oauth.name },
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async #buildModels(providerId: string): Promise<readonly ModelSummary[]> {
    const models = await this.collection();
    return models
      .getModels(providerId)
      .map((model) => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        reasoning: model.reasoning,
        cost: {
          input: model.cost.input,
          output: model.cost.output,
          cacheRead: model.cost.cacheRead,
          cacheWrite: model.cost.cacheWrite,
        },
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}
