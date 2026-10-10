import type { MutableModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";

/**
 * Offline provider for integration tests, loaded by a harness process through
 * `NEXUS_PROVIDERS_MODULE`. Every request answers with `NEXUS_FAUX_REPLY`, and the scripted step
 * re-queues itself so the queue never runs dry across turns.
 */
export default function registerFaux(models: MutableModels): void {
  const reply = process.env.NEXUS_FAUX_REPLY ?? "ok";
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
  models.setProvider(faux.provider);
  const step = () => {
    faux.appendResponses([step]);
    return fauxAssistantMessage(reply);
  };
  faux.setResponses([step]);
}
