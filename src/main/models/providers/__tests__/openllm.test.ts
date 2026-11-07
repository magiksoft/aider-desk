import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenLlmProvider } from '@common/agent';
import { Model, ModelModality, ProviderProfile, SettingsData } from '@common/types';

const mockGetEffectiveEnvironmentVariable = vi.fn();
const mockCreateOpenAICompatible = vi.fn();
const mockCompatibleModel = vi.fn();

vi.mock('@/utils', () => ({
  getEffectiveEnvironmentVariable: (...args: unknown[]) => mockGetEffectiveEnvironmentVariable(...args),
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: (...args: unknown[]) => {
    mockCreateOpenAICompatible(...args);
    return mockCompatibleModel;
  },
}));

vi.mock('@/logger');

import { createOpenLlmLlm, getOpenLlmAiderMapping, hasOpenLlmEnvVars, loadOpenLlmModels } from '../openllm';

const createProfile = (provider: Partial<OpenLlmProvider> = {}): ProviderProfile =>
  ({
    id: 'openllm-test',
    provider: {
      name: 'openllm',
      baseUrl: 'http://127.0.0.1:8787/v1',
      apiKey: '',
      ...provider,
    } as OpenLlmProvider,
  }) as unknown as ProviderProfile;

const settings = {
  aider: { environmentVariables: '', options: '' },
} as unknown as SettingsData;

const mockFetchOk = (payload: unknown) => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

beforeEach(() => {
  mockGetEffectiveEnvironmentVariable.mockReturnValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('loadOpenLlmModels', () => {
  it('maps model card metadata and keeps only chat-capable models', async () => {
    mockFetchOk({
      data: [
        {
          id: 'ultra',
          capabilities: ['chat', 'vision', 'tools', 'streaming', 'reasoning'],
          max_input_tokens: 1000000,
          context_window: 900000,
          max_output_tokens: 128000,
        },
        {
          id: 'claude_code/claude-sonnet-5-5',
          capabilities: ['chat', 'streaming'],
          context_window: 200000,
        },
        { id: 'chatgpt/embed-1', capabilities: ['embedding'] },
        { id: 'custom:name/bare' },
      ],
    });

    const result = await loadOpenLlmModels(createProfile(), settings);

    expect(result.success).toBe(true);
    expect(result.models).toEqual([
      {
        id: 'ultra',
        providerId: 'openllm-test',
        maxInputTokens: 1000000,
        maxOutputTokensLimit: 128000,
        supportsTools: true,
        modalities: {
          input: [ModelModality.Text, ModelModality.Image],
          output: [ModelModality.Text],
        },
      },
      {
        id: 'claude_code/claude-sonnet-5-5',
        providerId: 'openllm-test',
        maxInputTokens: 200000,
        maxOutputTokensLimit: undefined,
        supportsTools: false,
        modalities: {
          input: [ModelModality.Text],
          output: [ModelModality.Text],
        },
      },
      {
        id: 'custom:name/bare',
        providerId: 'openllm-test',
        maxInputTokens: undefined,
        maxOutputTokensLimit: undefined,
        supportsTools: undefined,
        modalities: undefined,
      },
    ] satisfies Model[]);
  });

  it('does not report any pricing', async () => {
    mockFetchOk({ data: [{ id: 'plus', capabilities: ['chat'] }] });

    const result = await loadOpenLlmModels(createProfile(), settings);

    expect(result.models[0].inputCostPerToken).toBeUndefined();
    expect(result.models[0].outputCostPerToken).toBeUndefined();
  });

  it('sends no Authorization header when no key is configured', async () => {
    const fetchMock = mockFetchOk({ data: [] });

    await loadOpenLlmModels(createProfile(), settings);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/v1/models', {
      headers: undefined,
    });
  });

  it('sends the profile key as a bearer token', async () => {
    const fetchMock = mockFetchOk({ data: [] });

    await loadOpenLlmModels(createProfile({ apiKey: 'sk-llm-profile' }), settings);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/v1/models', {
      headers: { Authorization: 'Bearer sk-llm-profile' },
    });
  });

  it('falls back to OPENLLM_API_KEY and the default base URL, trimming trailing slashes', async () => {
    mockGetEffectiveEnvironmentVariable.mockReturnValue({
      value: 'sk-llm-env',
      source: 'process.env',
    });
    const fetchMock = mockFetchOk({ data: [] });

    await loadOpenLlmModels(createProfile({ baseUrl: 'https://www.openllm.sh/v1//' }), settings);
    await loadOpenLlmModels(createProfile({ baseUrl: '' }), settings);

    expect(mockGetEffectiveEnvironmentVariable).toHaveBeenCalledWith('OPENLLM_API_KEY', settings, undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://www.openllm.sh/v1/models', { headers: { Authorization: 'Bearer sk-llm-env' } });
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:8787/v1/models', { headers: { Authorization: 'Bearer sk-llm-env' } });
  });

  it('includes the status and response body in the error for non-ok responses', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => '{"error":{"type":"auth_error","message":"[openllm] API key required. Run openllm login"}}',
    }) as unknown as typeof fetch;

    const result = await loadOpenLlmModels(createProfile(), settings);

    expect(result.success).toBe(false);
    expect(result.models).toEqual([]);
    expect(result.error).toContain('401');
    expect(result.error).toContain('openllm login');
  });

  it('suggests starting the daemon when a loopback URL is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

    const result = await loadOpenLlmModels(createProfile(), settings);

    expect(result.success).toBe(false);
    expect(result.error).toContain('daemon is not reachable');
    expect(result.error).toContain('openllm start');
  });

  it('returns the original error when a non-loopback URL is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

    const result = await loadOpenLlmModels(createProfile({ baseUrl: 'https://www.openllm.sh/v1' }), settings);

    expect(result).toEqual({
      models: [],
      success: false,
      error: 'fetch failed',
    });
  });
});

describe('hasOpenLlmEnvVars', () => {
  it('is true when OPENLLM_API_KEY resolves to a value', () => {
    mockGetEffectiveEnvironmentVariable.mockReturnValue({
      value: 'sk-llm-env',
      source: 'process.env',
    });

    expect(hasOpenLlmEnvVars(settings)).toBe(true);
    expect(mockGetEffectiveEnvironmentVariable).toHaveBeenCalledWith('OPENLLM_API_KEY', settings, undefined);
  });

  it('is false when OPENLLM_API_KEY is missing or empty', () => {
    expect(hasOpenLlmEnvVars(settings)).toBe(false);

    mockGetEffectiveEnvironmentVariable.mockReturnValue({
      value: '',
      source: 'process.env',
    });
    expect(hasOpenLlmEnvVars(settings)).toBe(false);
  });
});

describe('getOpenLlmAiderMapping', () => {
  it('uses a placeholder key when no key is configured', () => {
    const mapping = getOpenLlmAiderMapping(createProfile(), 'ultra', settings, '/project');

    expect(mapping).toEqual({
      modelName: 'openai/ultra',
      environmentVariables: {
        OPENAI_API_BASE: 'http://127.0.0.1:8787/v1',
        OPENAI_API_KEY: 'openllm',
      },
    });
  });

  it('uses the configured key and base URL', () => {
    const mapping = getOpenLlmAiderMapping(
      createProfile({
        baseUrl: 'https://www.openllm.sh/v1/',
        apiKey: 'sk-llm-profile',
      }),
      'plus',
      settings,
      '/project',
    );

    expect(mapping.environmentVariables).toEqual({
      OPENAI_API_BASE: 'https://www.openllm.sh/v1',
      OPENAI_API_KEY: 'sk-llm-profile',
    });
  });
});

describe('createOpenLlmLlm', () => {
  it('omits the api key when none is configured', () => {
    createOpenLlmLlm(createProfile(), { id: 'ultra', providerId: 'openllm-test' }, settings, '/project');

    expect(mockCreateOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'openllm',
        baseURL: 'http://127.0.0.1:8787/v1',
        apiKey: undefined,
      }),
    );
    expect(mockCompatibleModel).toHaveBeenCalledWith('ultra');
  });
});
