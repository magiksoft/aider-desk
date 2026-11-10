import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LangfuseSpanProcessor } from '@langfuse/otel';

import { initializeLangfuseSpanProcessor } from '../langfuse';

import { getEffectiveEnvironmentVariable } from '@/utils/environment';

vi.mock('@langfuse/otel', () => ({
  LangfuseSpanProcessor: vi.fn(class {}),
}));
vi.mock('@/utils/environment', () => ({ getEffectiveEnvironmentVariable: vi.fn() }));
vi.mock('@/logger', () => ({ default: { info: vi.fn() } }));

const variables: Record<string, string> = {};

describe('Langfuse span processor configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(variables).forEach((key) => delete variables[key]);
    vi.mocked(getEffectiveEnvironmentVariable).mockImplementation((key) =>
      variables[key] === undefined ? undefined : { value: variables[key], source: 'test' },
    );
  });

  it.each([{}, { LANGFUSE_PUBLIC_KEY: 'public-key' }, { LANGFUSE_SECRET_KEY: 'secret-key' }])(
    'does not initialize without both credentials: %j',
    (credentials) => {
      Object.assign(variables, credentials);

      expect(initializeLangfuseSpanProcessor()).toBeUndefined();
      expect(LangfuseSpanProcessor).not.toHaveBeenCalled();
    },
  );

  it('passes effective credentials explicitly and defaults to Langfuse Cloud', () => {
    Object.assign(variables, { LANGFUSE_PUBLIC_KEY: 'public-key', LANGFUSE_SECRET_KEY: 'secret-key' });

    expect(initializeLangfuseSpanProcessor()).toBeDefined();
    expect(LangfuseSpanProcessor).toHaveBeenCalledWith({
      publicKey: 'public-key',
      secretKey: 'secret-key',
      baseUrl: 'https://cloud.langfuse.com',
    });
  });

  it('preserves LANGFUSE_HOST for regional and self-hosted deployments', () => {
    Object.assign(variables, {
      LANGFUSE_PUBLIC_KEY: 'public-key',
      LANGFUSE_SECRET_KEY: 'secret-key',
      LANGFUSE_HOST: 'https://langfuse.example.com',
    });

    initializeLangfuseSpanProcessor();

    expect(LangfuseSpanProcessor).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'https://langfuse.example.com' }));
  });

  it.each([
    ['https://cloud.langfuse.com/', 'https://cloud.langfuse.com'],
    ['https://langfuse.example.com//', 'https://langfuse.example.com'],
    ['https://example.com/langfuse/', 'https://example.com/langfuse'],
  ])('removes trailing slashes from LANGFUSE_HOST %s', (host, baseUrl) => {
    Object.assign(variables, { LANGFUSE_PUBLIC_KEY: 'public-key', LANGFUSE_SECRET_KEY: 'secret-key', LANGFUSE_HOST: host });

    initializeLangfuseSpanProcessor();

    expect(LangfuseSpanProcessor).toHaveBeenCalledWith(expect.objectContaining({ baseUrl }));
  });
});
