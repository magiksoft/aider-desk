import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultProviderParams, OpenLlmProvider } from '@common/agent';
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

const mockEnv = (env: Record<string, string>) => {
  mockGetEffectiveEnvironmentVariable.mockImplementation((key: string) => (env[key] !== undefined ? { value: env[key], source: 'process.env' } : undefined));
};

beforeEach(() => {
  mockGetEffectiveEnvironmentVariable.mockReset();
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
    mockEnv({ OPENLLM_API_KEY: 'sk-llm-env' });
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

describe('loadOpenLlmModels error handling', () => {
  it('keeps the original error when a reachable daemon returns malformed JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    }) as unknown as typeof fetch;

    const result = await loadOpenLlmModels(createProfile(), settings);

    expect(result).toEqual({
      models: [],
      success: false,
      error: 'Unexpected token < in JSON at position 0',
    });
    expect(result.error).not.toContain('openllm start');
  });

  it('keeps the original error when the payload cannot be processed', async () => {
    mockFetchOk({ data: [null] });

    const result = await loadOpenLlmModels(createProfile(), settings);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error).not.toContain('openllm start');
  });

  it('suggests starting the daemon for ECONNREFUSED on localhost', async () => {
    const error = new TypeError('fetch failed');
    (error as { cause?: unknown }).cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8787'), { code: 'ECONNREFUSED' });
    global.fetch = vi.fn().mockRejectedValue(error) as unknown as typeof fetch;

    const result = await loadOpenLlmModels(createProfile(), settings);

    expect(result.error).toContain('openllm start');
  });
});

describe('OPENLLM_BASE_URL', () => {
  it('uses OPENLLM_BASE_URL for model discovery when the profile has no URL', async () => {
    mockEnv({ OPENLLM_API_KEY: 'sk-llm-env', OPENLLM_BASE_URL: 'https://www.openllm.sh/v1/' });
    const fetchMock = mockFetchOk({ data: [] });

    await loadOpenLlmModels(createProfile({ baseUrl: '' }), settings);

    expect(mockGetEffectiveEnvironmentVariable).toHaveBeenCalledWith('OPENLLM_BASE_URL', settings, undefined);
    expect(fetchMock).toHaveBeenCalledWith('https://www.openllm.sh/v1/models', { headers: { Authorization: 'Bearer sk-llm-env' } });
  });

  it('prefers an explicit profile URL over OPENLLM_BASE_URL', async () => {
    mockEnv({ OPENLLM_BASE_URL: 'https://www.openllm.sh/v1' });
    const fetchMock = mockFetchOk({ data: [] });

    await loadOpenLlmModels(createProfile({ baseUrl: 'http://127.0.0.1:9999/v1' }), settings);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9999/v1/models', { headers: undefined });
  });

  it('falls back to the local default when neither is set', async () => {
    const fetchMock = mockFetchOk({ data: [] });

    await loadOpenLlmModels(createProfile({ baseUrl: '' }), settings);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/v1/models', { headers: undefined });
  });

  it('applies the same precedence in Aider mode', () => {
    mockEnv({ OPENLLM_API_KEY: 'sk-llm-env', OPENLLM_BASE_URL: 'https://www.openllm.sh/v1' });

    const fromEnv = getOpenLlmAiderMapping(createProfile({ baseUrl: '' }), 'plus', settings, '/project');
    const explicit = getOpenLlmAiderMapping(createProfile({ baseUrl: 'http://127.0.0.1:9999/v1' }), 'plus', settings, '/project');

    expect(mockGetEffectiveEnvironmentVariable).toHaveBeenCalledWith('OPENLLM_BASE_URL', settings, '/project');
    expect(fromEnv.environmentVariables).toEqual({ OPENAI_API_BASE: 'https://www.openllm.sh/v1', OPENAI_API_KEY: 'sk-llm-env' });
    expect(explicit.environmentVariables).toEqual({ OPENAI_API_BASE: 'http://127.0.0.1:9999/v1', OPENAI_API_KEY: 'sk-llm-env' });
  });

  it('applies the same precedence in Agent mode', () => {
    mockEnv({ OPENLLM_API_KEY: 'sk-llm-env', OPENLLM_BASE_URL: 'https://www.openllm.sh/v1' });

    createOpenLlmLlm(createProfile({ baseUrl: '' }), { id: 'plus', providerId: 'openllm-test' }, settings, '/project');
    createOpenLlmLlm(createProfile({ baseUrl: 'http://127.0.0.1:9999/v1' }), { id: 'plus', providerId: 'openllm-test' }, settings, '/project');

    expect(mockCreateOpenAICompatible).toHaveBeenNthCalledWith(1, expect.objectContaining({ baseURL: 'https://www.openllm.sh/v1', apiKey: 'sk-llm-env' }));
    expect(mockCreateOpenAICompatible).toHaveBeenNthCalledWith(2, expect.objectContaining({ baseURL: 'http://127.0.0.1:9999/v1', apiKey: 'sk-llm-env' }));
  });

  it('auto-registered default profile does not shadow OPENLLM_BASE_URL', () => {
    mockEnv({ OPENLLM_API_KEY: 'sk-llm-env', OPENLLM_BASE_URL: 'https://www.openllm.sh/v1' });
    const provider = getDefaultProviderParams('openllm') as OpenLlmProvider;
    const profile = { id: 'openllm', provider } as ProviderProfile;

    expect(provider.baseUrl).toBe('');
    expect(getOpenLlmAiderMapping(profile, 'plus', settings, '/project').environmentVariables?.OPENAI_API_BASE).toBe('https://www.openllm.sh/v1');
  });
});

describe('hasOpenLlmEnvVars', () => {
  it('is true for a cloud-only setup with OPENLLM_API_KEY and OPENLLM_BASE_URL', () => {
    mockEnv({ OPENLLM_API_KEY: 'sk-llm-env', OPENLLM_BASE_URL: 'https://www.openllm.sh/v1' });

    expect(hasOpenLlmEnvVars(settings)).toBe(true);
  });

  it('is true when only OPENLLM_BASE_URL is set', () => {
    mockEnv({ OPENLLM_BASE_URL: 'https://www.openllm.sh/v1' });

    expect(hasOpenLlmEnvVars(settings)).toBe(true);
  });

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
