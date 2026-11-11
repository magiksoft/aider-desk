import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelModality, ProviderProfile, SettingsData } from '@common/types';

const mockGetEffectiveEnvironmentVariable = vi.fn();

vi.mock('@/utils', () => ({
  getEffectiveEnvironmentVariable: (...args: unknown[]) => mockGetEffectiveEnvironmentVariable(...args),
}));

vi.mock('@/logger');

import { atlasCloudProviderStrategy } from '../atlascloud';

const profile = {
  id: 'atlas-test',
  provider: { name: 'atlascloud', apiKey: 'test-key' },
} as unknown as ProviderProfile;

const settings = { aider: { environmentVariables: '', options: '' } } as unknown as SettingsData;

describe('atlascloud provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mockGetEffectiveEnvironmentVariable.mockReset();
  });

  it('maps /v1/models metadata into Model fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'deepseek-ai/deepseek-v3.2',
              context_length: 163840,
              max_output_length: 8192,
              input_modalities: ['text', 'image'],
              output_modalities: ['text'],
              pricing: { prompt: '0.00000026', completion: '0.00000038', image: '0', request: '0', input_cache_read: '0.00000013' },
            },
            { id: 'bare/model', pricing: { prompt: '0', completion: '0' } },
          ],
        }),
      }),
    );

    const result = await atlasCloudProviderStrategy.loadModels!(profile, settings);

    expect(result.success).toBe(true);
    expect(result.models[0]).toEqual({
      id: 'deepseek-ai/deepseek-v3.2',
      providerId: 'atlas-test',
      maxInputTokens: 163840,
      maxOutputTokensLimit: 8192,
      inputCostPerToken: 0.00000026,
      outputCostPerToken: 0.00000038,
      cacheWriteInputTokenCost: undefined,
      cacheReadInputTokenCost: 0.00000013,
      modalities: { input: [ModelModality.Text, ModelModality.Image], output: [ModelModality.Text] },
    });
    expect(result.models[1].inputCostPerToken).toBeUndefined();
    expect(result.models[1].modalities).toBeUndefined();
  });

  it('detects ATLASCLOUD_API_KEY from the environment', () => {
    mockGetEffectiveEnvironmentVariable.mockReturnValue({ value: 'k', source: 'env' });
    expect(atlasCloudProviderStrategy.hasEnvVars(settings)).toBe(true);
    mockGetEffectiveEnvironmentVariable.mockReturnValue(undefined);
    expect(atlasCloudProviderStrategy.hasEnvVars(settings)).toBe(false);
  });
});
