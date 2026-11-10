import { Model, ModelModality, ProviderProfile, SettingsData } from '@common/types';
import { isOpenLlmProvider, OpenLlmProvider } from '@common/agent';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import type { LanguageModel } from 'ai';

import { AiderModelMapping, LlmProviderStrategy, LoadModelsResponse } from '@/models';
import logger from '@/logger';
import { getEffectiveEnvironmentVariable } from '@/utils';
import { getDefaultUsageReport } from '@/models/providers/default';

const OPENLLM_DEFAULT_BASE_URL = 'http://127.0.0.1:8787/v1';
const OPENLLM_API_KEY_ENV = 'OPENLLM_API_KEY';
const OPENLLM_BASE_URL_ENV = 'OPENLLM_BASE_URL';
// The local daemon ignores bearers that are not sk-llm keys and uses the saved login, but Aider needs a non-empty key.
const OPENLLM_AIDER_PLACEHOLDER_KEY = 'openllm';

interface OpenLlmModelCard {
  id: string;
  capabilities?: string[];
  max_input_tokens?: number;
  context_window?: number;
  max_output_tokens?: number;
}

interface OpenLlmModelsResponse {
  data?: OpenLlmModelCard[];
}

// Precedence: explicit profile URL, then OPENLLM_BASE_URL, then the local daemon default.
const getBaseUrl = (provider: OpenLlmProvider, settings: SettingsData, projectDir?: string): string => {
  const baseUrl =
    provider.baseUrl?.trim() || getEffectiveEnvironmentVariable(OPENLLM_BASE_URL_ENV, settings, projectDir)?.value?.trim() || OPENLLM_DEFAULT_BASE_URL;
  return baseUrl.replace(/\/+$/g, '');
};

const getApiKey = (provider: OpenLlmProvider, settings: SettingsData, projectDir?: string): string =>
  provider.apiKey || getEffectiveEnvironmentVariable(OPENLLM_API_KEY_ENV, settings, projectDir)?.value || '';

const isLoopbackUrl = (url: string): boolean => {
  try {
    const hostname = new URL(url).hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
  } catch {
    return false;
  }
};

const getErrorMessage = (error: unknown): string =>
  typeof error === 'string' ? error : error instanceof Error ? error.message : 'Unknown error loading OpenLLM models';

const isChatModel = (card: OpenLlmModelCard): boolean => !Array.isArray(card.capabilities) || card.capabilities.includes('chat');

const toModel = (card: OpenLlmModelCard, providerId: string): Model => {
  const capabilities = Array.isArray(card.capabilities) ? card.capabilities : undefined;

  return {
    id: card.id,
    providerId,
    maxInputTokens: card.max_input_tokens ?? card.context_window,
    maxOutputTokensLimit: card.max_output_tokens,
    supportsTools: capabilities ? capabilities.includes('tools') : undefined,
    modalities: capabilities
      ? {
          input: capabilities.includes('vision') ? [ModelModality.Text, ModelModality.Image] : [ModelModality.Text],
          output: [ModelModality.Text],
        }
      : undefined,
  } satisfies Model;
};

export const loadOpenLlmModels = async (profile: ProviderProfile, settings: SettingsData): Promise<LoadModelsResponse> => {
  if (!isOpenLlmProvider(profile.provider)) {
    return { models: [], success: false };
  }

  const provider = profile.provider as OpenLlmProvider;
  const baseUrl = getBaseUrl(provider, settings);
  const apiKey = getApiKey(provider, settings);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
  } catch (error) {
    // fetch only rejects when the request could not be made (connection refused, DNS failure, network error)
    logger.error('Error connecting to OpenLLM:', error);
    if (isLoopbackUrl(baseUrl)) {
      return {
        models: [],
        success: false,
        error: `The OpenLLM daemon is not reachable at ${baseUrl}. Start it with "openllm start" (install: curl -fsSL https://www.openllm.sh/install | bash).`,
      };
    }
    return { models: [], success: false, error: getErrorMessage(error) };
  }

  try {
    if (!response.ok) {
      const errorMsg = `OpenLLM models API response failed: ${response.status} ${response.statusText} ${await response.text()}`;
      logger.warn(errorMsg);
      return { models: [], success: false, error: errorMsg };
    }

    const data = (await response.json()) as OpenLlmModelsResponse;
    const models = data.data?.filter(isChatModel).map((card) => toModel(card, profile.id)) || [];

    logger.info(`Loaded ${models.length} OpenLLM models from ${baseUrl} for profile ${profile.id}`);
    return { models, success: true };
  } catch (error) {
    // The endpoint was reachable, so keep the original error (for example malformed JSON or an unexpected payload)
    logger.error('Error loading OpenLLM models:', error);
    return { models: [], success: false, error: getErrorMessage(error) };
  }
};

export const hasOpenLlmEnvVars = (settings: SettingsData): boolean => {
  return (
    !!getEffectiveEnvironmentVariable(OPENLLM_API_KEY_ENV, settings, undefined)?.value ||
    !!getEffectiveEnvironmentVariable(OPENLLM_BASE_URL_ENV, settings, undefined)?.value
  );
};

export const getOpenLlmAiderMapping = (profile: ProviderProfile, modelId: string, settings: SettingsData, projectDir: string): AiderModelMapping => {
  const provider = profile.provider as OpenLlmProvider;

  return {
    modelName: `openai/${modelId}`,
    environmentVariables: {
      OPENAI_API_BASE: getBaseUrl(provider, settings, projectDir),
      OPENAI_API_KEY: getApiKey(provider, settings, projectDir) || OPENLLM_AIDER_PLACEHOLDER_KEY,
    },
  };
};

// === LLM Creation Functions ===
export const createOpenLlmLlm = (profile: ProviderProfile, model: Model, settings: SettingsData, projectDir: string): LanguageModel => {
  const provider = profile.provider as OpenLlmProvider;

  const openLlmProvider = createOpenAICompatible({
    name: 'openllm',
    baseURL: getBaseUrl(provider, settings, projectDir),
    apiKey: getApiKey(provider, settings, projectDir) || undefined,
    headers: profile.headers,
    includeUsage: true,
  });
  return openLlmProvider(model.id);
};

// === Complete Strategy Implementation ===
export const openLlmProviderStrategy: LlmProviderStrategy = {
  // Core LLM functions
  createLlm: createOpenLlmLlm,
  getUsageReport: getDefaultUsageReport,

  // Model discovery functions
  loadModels: loadOpenLlmModels,
  hasEnvVars: hasOpenLlmEnvVars,
  getAiderMapping: getOpenLlmAiderMapping,
};
