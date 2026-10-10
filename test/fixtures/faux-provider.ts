import type { MutableModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";

/**
 * Emits output over time, so a client can be seen streaming tool output rather than receiving it all
 * at once.
 */
const STREAMING_COMMAND = "for i in 1 2 3; do echo line $i; sleep 0.4; done";

/**
 * Offline provider for integration tests, loaded by a harness process through
 * `NEXUS_PROVIDERS_MODULE`.
 *
 * `NEXUS_FAUX_REPLY` is the text of every answer. `NEXUS_FAUX_SCRIPT=tools` instead runs a two-step
 * script — a tool call followed by a closing answer — so a client's tool rendering can be exercised
 * against real events. The script re-queues a plain answer at the end so the queue never runs dry.
 */
export default function registerFaux(models: MutableModels): void {
  const reply = process.env.NEXUS_FAUX_REPLY ?? "ok";
  const script = process.env.NEXUS_FAUX_SCRIPT ?? "text";
  const contextWindow = Number(process.env.NEXUS_FAUX_CONTEXT_WINDOW ?? "");
  // A rate slow enough to watch a partial arrive, which is how streaming is verified.
  const tokensPerSecond = Number(process.env.NEXUS_FAUX_TOKENS_PER_SECOND ?? "");
  const faux = fauxProvider({
    provider: "faux",
    models: [
      {
        id: "faux-1",
        ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
      },
    ],
    ...(Number.isFinite(tokensPerSecond) && tokensPerSecond > 0 ? { tokensPerSecond } : {}),
  });
  models.setProvider(faux.provider);

  const answer = () => {
    faux.appendResponses([answer]);
    return fauxAssistantMessage(reply);
  };

  if (script === "tools") {
    faux.setResponses([
      // `toolUse` is what tells the agent loop to run the call and continue rather than treat the
      // response as the final answer.
      fauxAssistantMessage(
        [
          fauxText("Let me check the repository.\n"),
          fauxToolCall("bash", { command: STREAMING_COMMAND }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("The command finished."),
      answer,
    ]);
    return;
  }

  faux.setResponses([answer]);
}
