import { generateText } from "ai";
import { hasApiKey, getConfiguredModel } from "./config";
import { generateTextViaCli } from "./cli-fallback";
import type { Provider } from "./provider";

/**
 * Generate text using SDK if API key available, otherwise fall back to claude CLI.
 */
export async function generateTextAuto(options: {
  provider?: Provider;
  model?: string;
  system: string;
  prompt: string;
}): Promise<string> {
  const provider = options.provider || "anthropic";

  if (hasApiKey(provider)) {
    const model = getConfiguredModel(provider, options.model);
    const result = await generateText({
      model,
      system: options.system,
      prompt: options.prompt,
    });
    return result.text.trim();
  }

  // Fallback to claude CLI
  const fullPrompt = `${options.system}\n\n---\n\n${options.prompt}`;
  return generateTextViaCli(fullPrompt);
}
