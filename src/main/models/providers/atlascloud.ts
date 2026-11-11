import { Model, ModelModality, ProviderProfile, SettingsData } from '@common/types';
import { isAtlasCloudProvider, AtlasCloudProvider } from '@common/agent';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import { getDefaultModelInfo, getDefaultUsageReport } from './default';

import type { LanguageModel } from 'ai';

import { AIDER_DESK_TITLE, AIDER_DESK_WEBSITE } from '@/constants';
import { AiderModelMapping, LlmProviderStrategy, LoadModelsResponse } from '@/models';
import logger from '@/logger';
import { getEffectiveEnvironmentVariable } from '@/utils';

const ATLASCLOUD_BASE_URL = 'https://api.atlascloud.ai/v1';

interface AtlasCloudPricing {
  prompt?: string;
  completion?: string;
  input_cache_read?: string;
  input_cache_write?: string;
}

interface AtlasCloudModel {
  id: string;
  context_length?: number;
  max_output_length?: number;
  input_modalities?: string[];
  output_modalities?: string[];
  pricing?: AtlasCloudPricing;
}

interface AtlasCloudModelsResponse {
  data?: AtlasCloudModel[];
}

// Pricing values are already per-token prices, returned as strings
const parsePrice = (price: string | undefined): number | undefined => {
  if (!price) {
    return undefined;
  }
  const value = Number(price);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const MODALITY_MAP: Record<string, ModelModality> = {
  text: ModelModality.Text,
  image: ModelModality.Image,
  audio: ModelModality.Audio,
  video: ModelModality.Video,
  pdf: ModelModality.Pdf,
};

const parseModalities = (values: string[] | undefined): ModelModality[] =>
  (values ?? []).map((value) => MODALITY_MAP[value]).filter((value): value is ModelModality => value !== undefined);

const toModel = (model: AtlasCloudModel, profileId: string): Model => {
  const input = parseModalities(model.input_modalities);
  const output = parseModalities(model.output_modalities);

  return {
    id: model.id,
    providerId: profileId,
    maxInputTokens: model.context_length,
    maxOutputTokensLimit: model.max_output_length,
    inputCostPerToken: parsePrice(model.pricing?.prompt),
    outputCostPerToken: parsePrice(model.pricing?.completion),
    cacheWriteInputTokenCost: parsePrice(model.pricing?.input_cache_write),
    cacheReadInputTokenCost: parsePrice(model.pricing?.input_cache_read),
    modalities: input.length > 0 || output.length > 0 ? { input, output } : undefined,
  } satisfies Model;
};

const loadAtlasCloudModels = async (profile: ProviderProfile, settings: SettingsData): Promise<LoadModelsResponse> => {
  if (!isAtlasCloudProvider(profile.provider)) {
    return { models: [], success: false };
  }

  const provider = profile.provider as AtlasCloudProvider;
  const apiKey = provider.apiKey || '';

  const apiKeyEnv = getEffectiveEnvironmentVariable('ATLASCLOUD_API_KEY', settings);

  const effectiveApiKey = apiKey || apiKeyEnv?.value;

  if (!effectiveApiKey) {
    return { models: [], success: false };
  }

  try {
    const response = await fetch(`${ATLASCLOUD_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${effectiveApiKey}` },
    });
    if (!response.ok) {
      const errorMsg = `Atlas Cloud models API response failed: ${response.status} ${response.statusText} ${await response.text()}`;
      logger.debug(errorMsg);
      return { models: [], success: false, error: errorMsg };
    }

    const data = (await response.json()) as AtlasCloudModelsResponse;
    const models = data.data?.map((model) => toModel(model, profile.id)) || [];

    logger.info(`Loaded ${models.length} Atlas Cloud models for profile ${profile.id}`);
    return { models, success: true };
  } catch (error) {
    const errorMsg = typeof error === 'string' ? error : error instanceof Error ? error.message : 'Unknown error loading Atlas Cloud models';
    logger.warn('Failed to fetch Atlas Cloud models via API:', error);
    return { models: [], success: false, error: errorMsg };
  }
};

const hasAtlasCloudEnvVars = (settings: SettingsData): boolean => {
  return !!getEffectiveEnvironmentVariable('ATLASCLOUD_API_KEY', settings)?.value;
};

const getAtlasCloudAiderMapping = (provider: ProviderProfile, modelId: string, settings: SettingsData, projectDir: string): AiderModelMapping => {
  const atlasCloudProvider = provider.provider as AtlasCloudProvider;
  const envVars: Record<string, string> = {};

  if (atlasCloudProvider.apiKey) {
    envVars.OPENAI_API_KEY = atlasCloudProvider.apiKey;
  } else {
    const effectiveVar = getEffectiveEnvironmentVariable('ATLASCLOUD_API_KEY', settings, projectDir);
    if (effectiveVar) {
      envVars.OPENAI_API_KEY = effectiveVar.value;
    }
  }

  envVars.OPENAI_API_BASE = ATLASCLOUD_BASE_URL;

  return {
    modelName: `openai/${modelId}`,
    environmentVariables: envVars,
  };
};

const createAtlasCloudLlm = (profile: ProviderProfile, model: Model, settings: SettingsData, projectDir: string): LanguageModel => {
  const provider = profile.provider as AtlasCloudProvider;
  let apiKey = provider.apiKey;

  if (!apiKey) {
    const effectiveVar = getEffectiveEnvironmentVariable('ATLASCLOUD_API_KEY', settings, projectDir);
    if (effectiveVar) {
      apiKey = effectiveVar.value;
      logger.debug(`Loaded ATLASCLOUD_API_KEY from ${effectiveVar.source}`);
    }
  }

  if (!apiKey) {
    throw new Error(`API key is required for ${provider.name}. Check Providers settings or Aider environment variables (ATLASCLOUD_API_KEY).`);
  }

  const compatibleProvider = createOpenAICompatible({
    name: provider.name,
    apiKey,
    baseURL: ATLASCLOUD_BASE_URL,
    headers: {
      ...profile.headers,
      'HTTP-Referer': AIDER_DESK_WEBSITE,
      'X-Title': AIDER_DESK_TITLE,
    },
  });
  return compatibleProvider(model.id);
};

export const atlasCloudProviderStrategy: LlmProviderStrategy = {
  createLlm: createAtlasCloudLlm,
  getUsageReport: getDefaultUsageReport,

  loadModels: loadAtlasCloudModels,
  hasEnvVars: hasAtlasCloudEnvVars,
  getAiderMapping: getAtlasCloudAiderMapping,
  getModelInfo: getDefaultModelInfo,
};
