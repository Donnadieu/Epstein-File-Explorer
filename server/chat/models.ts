import OpenAI from "openai";

export interface ModelConfig {
  id: string;
  label: string;
  provider: "deepseek" | "openai";
  model: string;
  inputCostPerM: number;  // cents per million input tokens
  outputCostPerM: number; // cents per million output tokens
  maxTokens: number;
  envKey: string;
}

export const AVAILABLE_MODELS: Record<string, ModelConfig> = {
  "deepseek-chat": {
    id: "deepseek-chat",
    label: "DeepSeek V3",
    provider: "deepseek",
    model: "deepseek-chat",
    inputCostPerM: 0.27,
    outputCostPerM: 1.10,
    maxTokens: 4096,
    envKey: "DEEPSEEK_API_KEY",
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    label: "GPT-4o Mini",
    provider: "openai",
    model: "gpt-4o-mini",
    inputCostPerM: 0.15,
    outputCostPerM: 0.60,
    maxTokens: 4096,
    envKey: "OPENAI_API_KEY",
  },
};

export const DEFAULT_MODEL_ID = "deepseek-chat";

const clients = new Map<string, OpenAI>();

function getBaseURL(provider: string): string | undefined {
  switch (provider) {
    case "deepseek":
      return "https://api.deepseek.com";
    case "openai":
      return undefined; // OpenAI SDK default
    default:
      return undefined;
  }
}

export function getModelConfig(modelId?: string): ModelConfig {
  if (!modelId || !AVAILABLE_MODELS[modelId]) {
    return AVAILABLE_MODELS[DEFAULT_MODEL_ID];
  }
  return AVAILABLE_MODELS[modelId];
}

export function getClient(modelId?: string): OpenAI {
  const config = getModelConfig(modelId);
  const key = config.id;

  if (!clients.has(key)) {
    const apiKey = process.env[config.envKey];
    if (!apiKey) {
      throw new Error(`${config.envKey} not set — cannot use model ${config.label}`);
    }
    const baseURL = getBaseURL(config.provider);
    clients.set(key, new OpenAI({ baseURL, apiKey }));
  }

  return clients.get(key)!;
}

export function calculateCostCents(
  inputTokens: number,
  outputTokens: number,
  modelId?: string,
): number {
  const config = getModelConfig(modelId);
  const inputCost = (inputTokens / 1_000_000) * config.inputCostPerM;
  const outputCost = (outputTokens / 1_000_000) * config.outputCostPerM;
  return Math.ceil((inputCost + outputCost) * 100) / 100;
}

export function isModelAvailable(modelId: string): boolean {
  const config = AVAILABLE_MODELS[modelId];
  if (!config) return false;
  return !!process.env[config.envKey];
}
