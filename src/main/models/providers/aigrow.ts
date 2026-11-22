import { Model, ProviderProfile, SettingsData } from '@common/types';
import { isAigrowProvider, AigrowProvider } from '@common/agent';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import { getDefaultModelInfo, getDefaultUsageReport } from './default';

import type { LanguageModel } from 'ai';

import { AIDER_DESK_TITLE, AIDER_DESK_WEBSITE } from '@/constants';
import { AiderModelMapping, LlmProviderStrategy, LoadModelsResponse } from '@/models';
import logger from '@/logger';
import { getEffectiveEnvironmentVariable } from '@/utils';

const AIGROW_BASE_URL = 'https://aigrow.gg/v1';

interface AigrowPricing {
  prompt?: string;
  completion?: string;
}

interface AigrowModel {
  id: string;
  context_length?: number;
  context_window?: number;
  pricing?: AigrowPricing;
}

interface AigrowModelsResponse {
  data?: AigrowModel[];
}

// Pricing values are already per-token prices in USD, returned as strings
const parsePrice = (price: string | undefined): number | undefined => {
  if (!price) {
    return undefined;
  }
  const value = Number(price);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const toModel = (model: AigrowModel, profileId: string): Model =>
  ({
    id: model.id,
    providerId: profileId,
    maxInputTokens: model.context_length ?? model.context_window,
    inputCostPerToken: parsePrice(model.pricing?.prompt),
    outputCostPerToken: parsePrice(model.pricing?.completion),
  }) satisfies Model;

const loadAigrowModels = async (profile: ProviderProfile, settings: SettingsData): Promise<LoadModelsResponse> => {
  if (!isAigrowProvider(profile.provider)) {
    return { models: [], success: false };
  }

  const provider = profile.provider as AigrowProvider;
  const apiKey = provider.apiKey || '';

  const apiKeyEnv = getEffectiveEnvironmentVariable('AIGROW_API_KEY', settings);

  const effectiveApiKey = apiKey || apiKeyEnv?.value;

  if (!effectiveApiKey) {
    return { models: [], success: false };
  }

  try {
    const response = await fetch(`${AIGROW_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${effectiveApiKey}` },
    });
    if (!response.ok) {
      const errorMsg = `AIGROW models API response failed: ${response.status} ${response.statusText} ${await response.text()}`;
      logger.debug(errorMsg);
      return { models: [], success: false, error: errorMsg };
    }

    const data = (await response.json()) as AigrowModelsResponse;
    const models = data.data?.map((model) => toModel(model, profile.id)) || [];

    logger.info(`Loaded ${models.length} AIGROW models for profile ${profile.id}`);
    return { models, success: true };
  } catch (error) {
    const errorMsg = typeof error === 'string' ? error : error instanceof Error ? error.message : 'Unknown error loading AIGROW models';
    logger.warn('Failed to fetch AIGROW models via API:', error);
    return { models: [], success: false, error: errorMsg };
  }
};

const hasAigrowEnvVars = (settings: SettingsData): boolean => {
  return !!getEffectiveEnvironmentVariable('AIGROW_API_KEY', settings)?.value;
};

const getAigrowAiderMapping = (provider: ProviderProfile, modelId: string, settings: SettingsData, projectDir: string): AiderModelMapping => {
  const aigrowProvider = provider.provider as AigrowProvider;
  const envVars: Record<string, string> = {};

  if (aigrowProvider.apiKey) {
    envVars.OPENAI_API_KEY = aigrowProvider.apiKey;
  } else {
    const effectiveVar = getEffectiveEnvironmentVariable('AIGROW_API_KEY', settings, projectDir);
    if (effectiveVar) {
      envVars.OPENAI_API_KEY = effectiveVar.value;
    }
  }

  envVars.OPENAI_API_BASE = AIGROW_BASE_URL;

  return {
    modelName: `openai/${modelId}`,
    environmentVariables: envVars,
  };
};

const createAigrowLlm = (profile: ProviderProfile, model: Model, settings: SettingsData, projectDir: string): LanguageModel => {
  const provider = profile.provider as AigrowProvider;
  let apiKey = provider.apiKey;

  if (!apiKey) {
    const effectiveVar = getEffectiveEnvironmentVariable('AIGROW_API_KEY', settings, projectDir);
    if (effectiveVar) {
      apiKey = effectiveVar.value;
      logger.debug(`Loaded AIGROW_API_KEY from ${effectiveVar.source}`);
    }
  }

  if (!apiKey) {
    throw new Error(`API key is required for ${provider.name}. Check Providers settings or Aider environment variables (AIGROW_API_KEY).`);
  }

  const compatibleProvider = createOpenAICompatible({
    name: provider.name,
    apiKey,
    baseURL: AIGROW_BASE_URL,
    headers: {
      ...profile.headers,
      'HTTP-Referer': AIDER_DESK_WEBSITE,
      'X-Title': AIDER_DESK_TITLE,
    },
  });
  return compatibleProvider(model.id);
};

export const aigrowProviderStrategy: LlmProviderStrategy = {
  createLlm: createAigrowLlm,
  getUsageReport: getDefaultUsageReport,

  loadModels: loadAigrowModels,
  hasEnvVars: hasAigrowEnvVars,
  getAiderMapping: getAigrowAiderMapping,
  getModelInfo: getDefaultModelInfo,
};
