import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export const SUPPORTED_PROVIDERS = ["anthropic", "openai", "glm"] as const;
export type Provider = (typeof SUPPORTED_PROVIDERS)[number];

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  glm: "glm-4-plus",
};

const DEFAULT_BASE_URLS: Partial<Record<Provider, string>> = {
  glm: "https://open.bigmodel.cn/api/paas/v4",
};

export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
}

export function getModelId(provider: Provider, model?: string): string {
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported provider: ${provider}`);
  }
  const modelName = model || DEFAULT_MODELS[provider];
  return `${provider}/${modelName}`;
}

/**
 * Create a language model instance with optional custom config.
 * GLM uses OpenAI-compatible API, so we use createOpenAI with GLM's base URL.
 */
export function createModel(
  provider: Provider,
  model?: string,
  config?: ProviderConfig
): LanguageModel | string {
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const modelName = model || DEFAULT_MODELS[provider];
  const hasCustomConfig =
    config?.baseURL || config?.apiKey || DEFAULT_BASE_URLS[provider];

  if (!hasCustomConfig) {
    return `${provider}/${modelName}`;
  }

  if (provider === "anthropic") {
    const anthropic = createAnthropic({
      ...(config?.apiKey && { apiKey: config.apiKey }),
      ...(config?.baseURL && { baseURL: config.baseURL }),
    });
    return anthropic(modelName);
  }

  // Both openai and glm use OpenAI-compatible API
  const baseURL =
    config?.baseURL || DEFAULT_BASE_URLS[provider];
  const openai = createOpenAI({
    ...(config?.apiKey && { apiKey: config.apiKey }),
    ...(baseURL && { baseURL }),
  });
  return openai(modelName);
}
