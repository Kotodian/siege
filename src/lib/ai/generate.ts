import { generateText } from "ai";
import { hasApiKey, getConfiguredModel } from "./config";
import { generateTextViaCli } from "./cli-fallback";
import { enqueueAiTask } from "./queue";
import type { Provider } from "./provider";

/**
 * Generate text using SDK if API key available, otherwise fall back to claude CLI.
 * CLI calls are serialized through a queue to prevent process pile-up.
 *
 * Pass sessionId to resume an existing claude session (much faster).
 * Returns { text, sessionId } — caller should store sessionId for next call.
 */
export async function generateTextAuto(options: {
  provider?: Provider;
  model?: string;
  system: string;
  prompt: string;
  sessionId?: string;
}): Promise<{ text: string; sessionId?: string }> {
  const provider = options.provider || "anthropic";

  if (hasApiKey(provider)) {
    const model = getConfiguredModel(provider, options.model);
    const result = await generateText({
      model,
      system: options.system,
      prompt: options.prompt,
    });
    return { text: result.text.trim() };
  }

  // Fallback to claude CLI — serialized through queue
  const fullPrompt = options.system
    ? `${options.system}\n\n---\n\n${options.prompt}`
    : options.prompt;

  return new Promise<{ text: string; sessionId?: string }>((resolve, reject) => {
    enqueueAiTask(async () => {
      try {
        const result = await generateTextViaCli(fullPrompt, options.sessionId);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  });
}
