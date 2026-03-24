import { getDb } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createModel, SUPPORTED_PROVIDERS, type Provider, type ProviderConfig } from "./provider";

function getSetting(key: string): string | undefined {
  const db = getDb();
  const s = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();
  return s?.value || undefined;
}

const ENV_KEY_MAP: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  glm: "GLM_API_KEY",
};

/**
 * Check if a provider has an API key configured (env or DB).
 */
export function hasApiKey(provider?: Provider): boolean {
  const resolvedProvider =
    provider || (getSetting("default_provider") as Provider) || "anthropic";
  const apiKey =
    process.env[ENV_KEY_MAP[resolvedProvider]] ||
    getSetting(`${resolvedProvider}_api_key`);
  return !!apiKey;
}

/**
 * Get the configured model for a provider, respecting custom base URLs
 * and API keys stored in settings or env vars.
 */
/**
 * Returns true if default provider is "acp" (not an SDK provider).
 */
export function isAcpDefault(): boolean {
  return getSetting("default_provider") === "acp";
}

export type AiStep = "scheme" | "review" | "schedule" | "execute" | "test" | "skills";

/**
 * Resolve provider + model for a specific AI step.
 * Priority: override params > step-specific settings > global default.
 */
export function resolveStepConfig(
  step: AiStep,
  overrideProvider?: string,
  overrideModel?: string
): { provider: string; model?: string } {
  const provider =
    overrideProvider ||
    getSetting(`step_provider_${step}`) ||
    getSetting("default_provider") ||
    "anthropic";
  const model =
    overrideModel ||
    getSetting(`step_model_${step}`) ||
    undefined;
  return { provider, model };
}

/**
 * Get a configured LanguageModel for a specific AI step.
 * Throws if the resolved provider is "acp"/"codex-acp" (not SDK providers).
 */
export function getStepModel(
  step: AiStep,
  overrideProvider?: string,
  overrideModel?: string
) {
  const { provider, model } = resolveStepConfig(step, overrideProvider, overrideModel);
  // ACP/Codex are CLI engines, not SDK providers.
  // For steps that only support SDK (review, test, etc.), fall back to
  // the first configured SDK provider instead of throwing.
  // Don't pass the ACP model name — it may not exist on the SDK provider.
  if (provider === "acp" || provider === "codex-acp" || provider === "copilot-acp") {
    return getConfiguredModel(undefined, undefined);
  }
  return getConfiguredModel(provider as Provider, model);
}

export function getConfiguredModel(provider?: Provider, model?: string) {
  let resolvedProvider =
    provider || (getSetting("default_provider") as Provider) || "anthropic";

  // "acp" is not an SDK provider — fallback to first configured SDK provider
  if (resolvedProvider === ("acp" as string)) {
    const fallback = SUPPORTED_PROVIDERS.find((p) => {
      const key = process.env[ENV_KEY_MAP[p]] || getSetting(`${p}_api_key`);
      return !!key;
    });
    resolvedProvider = fallback || "anthropic";
  }

  const resolvedModel = model || getSetting(`default_model_${resolvedProvider}`) || getSetting("default_model") || undefined;

  const config: ProviderConfig = {};
  const baseURL = getSetting(`${resolvedProvider}_base_url`);
  const apiKey =
    process.env[ENV_KEY_MAP[resolvedProvider]] ||
    getSetting(`${resolvedProvider}_api_key`);

  if (!apiKey && !baseURL) {
    throw new Error(
      `No API key configured for ${resolvedProvider}. Please configure an API key in Settings or set the ${ENV_KEY_MAP[resolvedProvider]} environment variable.`
    );
  }

  if (baseURL) config.baseURL = baseURL;
  if (apiKey) config.apiKey = apiKey;

  return createModel(resolvedProvider, resolvedModel, config);
}

/**
 * Prefix a prompt with a strong language instruction based on locale.
 * For ACP prompts where the agent's system prompt may override weak hints.
 */
export function withLocale(prompt: string, locale?: string): string {
  if (locale === "zh") {
    return `<language>简体中文</language>\n<instruction>你必须全程使用简体中文回复。所有解释、分析、总结都用中文。代码、文件路径、命令名保持原样。严禁使用英文或日文回复。</instruction>\n\n${prompt}`;
  }
  return prompt;
}
