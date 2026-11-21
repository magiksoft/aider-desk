import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderProfile, SettingsData } from '@common/types';

const mockGetEffectiveEnvironmentVariable = vi.fn();

vi.mock('@/utils', () => ({
  getEffectiveEnvironmentVariable: (...args: unknown[]) => mockGetEffectiveEnvironmentVariable(...args),
}));

vi.mock('@/logger');

import { aigrowProviderStrategy } from '../aigrow';

const profile = {
  id: 'aigrow-test',
  provider: { name: 'aigrow', apiKey: 'test-key' },
} as unknown as ProviderProfile;

const settings = { aider: { environmentVariables: '', options: '' } } as unknown as SettingsData;

describe('aigrow provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mockGetEffectiveEnvironmentVariable.mockReset();
  });

  it('maps /v1/models metadata into Model fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        object: 'list',
        data: [
          {
            id: 'claude-haiku-5.5',
            object: 'model',
            owned_by: 'aigrow',
            context_window: 1000000,
            context_length: 1000000,
            pricing: { prompt: '0.00000004', completion: '0.0000002' },
          },
          { id: 'window-only', context_window: 262144 },
          { id: 'bare/model', pricing: { prompt: '0', completion: '0' } },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await aigrowProviderStrategy.loadModels!(profile, settings);

    expect(fetchMock).toHaveBeenCalledWith('https://aigrow.gg/v1/models', { headers: { Authorization: 'Bearer test-key' } });
    expect(result.success).toBe(true);
    expect(result.models[0]).toEqual({
      id: 'claude-haiku-5.5',
      providerId: 'aigrow-test',
      maxInputTokens: 1000000,
      inputCostPerToken: 0.00000004,
      outputCostPerToken: 0.0000002,
    });
    expect(result.models[1].maxInputTokens).toBe(262144);
    expect(result.models[2].inputCostPerToken).toBeUndefined();
    expect(result.models[2].maxInputTokens).toBeUndefined();
  });

  it('does not call the API without a key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockGetEffectiveEnvironmentVariable.mockReturnValue(undefined);
    const keyless = { id: 'aigrow-test', provider: { name: 'aigrow', apiKey: '' } } as unknown as ProviderProfile;

    const result = await aigrowProviderStrategy.loadModels!(keyless, settings);

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps Aider mode to the OpenAI-compatible endpoint', () => {
    const mapping = aigrowProviderStrategy.getAiderMapping(profile, 'claude-haiku-5.5', settings, '/project');

    expect(mapping.modelName).toBe('openai/claude-haiku-5.5');
    expect(mapping.environmentVariables).toEqual({ OPENAI_API_KEY: 'test-key', OPENAI_API_BASE: 'https://aigrow.gg/v1' });
  });

  it('detects AIGROW_API_KEY from the environment', () => {
    mockGetEffectiveEnvironmentVariable.mockReturnValue({ value: 'k', source: 'env' });
    expect(aigrowProviderStrategy.hasEnvVars(settings)).toBe(true);
    mockGetEffectiveEnvironmentVariable.mockReturnValue(undefined);
    expect(aigrowProviderStrategy.hasEnvVars(settings)).toBe(false);
  });
});
