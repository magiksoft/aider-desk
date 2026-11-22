import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MODEL_FALLBACK_CONFIG,
  parseModelFallbackConfig,
  parseModelSelection,
  shouldTriggerFallback,
} from '../policy';

import type { ModelFallbackConfig } from '../policy';

const config = (overrides: Partial<ModelFallbackConfig> = {}): ModelFallbackConfig => ({
  ...DEFAULT_MODEL_FALLBACK_CONFIG,
  ...overrides,
});

describe('Model Fallback policy', () => {
  describe('parseModelSelection', () => {
    it('parses providerId and modelId including nested slashes', () => {
      expect(parseModelSelection('openrouter/anthropic/claude-sonnet-4')).toEqual({
        providerId: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4',
      });
    });

    it.each(['', 'no-slash', '/missing-provider', 'missing-model/', 'bad /model', null, 123])(
      'rejects invalid model ID %j',
      (value) => {
        expect(parseModelSelection(value)).toBeNull();
      },
    );
  });

  describe('parseModelFallbackConfig', () => {
    it('applies defaults for omitted fields', () => {
      expect(parseModelFallbackConfig({})).toEqual(DEFAULT_MODEL_FALLBACK_CONFIG);
    });

    it('accepts valid enabled and fallbackModelId values', () => {
      expect(parseModelFallbackConfig({ enabled: false, fallbackModelId: 'backup/model-a' })).toEqual({
        enabled: false,
        fallbackModelId: 'backup/model-a',
        customErrorCodes: [],
        customErrorPatterns: [],
      });
    });

    it('normalizes custom error codes and trims lists', () => {
      expect(
        parseModelFallbackConfig({
          customErrorCodes: [' ENTITLEMENT_ERROR ', 'entitlement_error', '', 'PLAN_REQUIRED'],
          customErrorPatterns: [' not subscribed ', ''],
        }),
      ).toEqual({
        enabled: true,
        fallbackModelId: '',
        customErrorCodes: ['entitlement_error', 'plan_required'],
        customErrorPatterns: ['not subscribed'],
      });
    });

    it.each([
      { customErrorCodes: 'ENTITLEMENT_ERROR' },
      { customErrorCodes: [42] },
      { customErrorPatterns: 'pattern' },
      { customErrorPatterns: [null] },
    ])('rejects invalid custom list %j', (value) => {
      expect(() => parseModelFallbackConfig(value)).toThrow();
    });

    it('rejects invalid regular expression patterns', () => {
      expect(() => parseModelFallbackConfig({ customErrorPatterns: ['not subscribed', '[invalid'] })).toThrow(/invalid regular expression/i);
    });

    it.each([null, [], { enabled: 'yes' }, { fallbackModelId: 'invalid' }])('rejects invalid config %j', (value) => {
      expect(() => parseModelFallbackConfig(value)).toThrow();
    });
  });

  describe('shouldTriggerFallback', () => {
    it.each([
      { statusCode: 429 },
      { lastError: { statusCode: 429 } },
      { cause: { data: { error: { type: 'rate_limit_error' } } } },
      { code: 'insufficient_quota' },
      { data: { error: { message: 'Usage limit reached for this billing window' } } },
      { statusCode: 400, responseBody: JSON.stringify({ error: { code: 'resource_exhausted' } }) },
      { statusCode: 402, responseBody: 'Insufficient credits remaining' },
    ])('matches quota/rate-limit error %j', (error) => {
      expect(shouldTriggerFallback(error, config())).toBe(true);
    });

    it.each([
      { statusCode: 403, code: 'ENTITLEMENT_ERROR' },
      {
        statusCode: 403,
        message:
          'Error 403: the user is not subscribed to required model plan: {"error":{"code":"ENTITLEMENT_ERROR","message":"Error 403: the user is not subscribed to required model plan"}}',
      },
      { lastError: { data: { error: { message: 'Your subscription has expired' } } } },
      { statusCode: 403, responseBody: JSON.stringify({ error: { code: 'ENTITLEMENT_ERROR' } }) },
    ])('matches subscription/entitlement error %j', (error) => {
      expect(shouldTriggerFallback(error, config())).toBe(true);
    });

    it('matches configured custom error codes', () => {
      expect(
        shouldTriggerFallback(
          { statusCode: 403, data: { error: { type: 'PLAN_REQUIRED' } } },
          config({ customErrorCodes: ['plan_required'] }),
        ),
      ).toBe(true);
      expect(shouldTriggerFallback({ statusCode: 403, code: 'OTHER_ERROR' }, config({ customErrorCodes: ['plan_required'] }))).toBe(false);
    });

    it('matches configured custom message patterns', () => {
      expect(
        shouldTriggerFallback({ statusCode: 403, message: 'User is not entitled to this model' }, config({ customErrorPatterns: ['not entitled to'] })),
      ).toBe(true);
      expect(
        shouldTriggerFallback(
          { statusCode: 403, responseBody: 'model access denied for this tier' },
          config({ customErrorPatterns: ['access denied for this tier'] }),
        ),
      ).toBe(true);
      expect(shouldTriggerFallback({ statusCode: 403, message: 'model not found' }, config({ customErrorPatterns: ['not entitled to'] }))).toBe(false);
    });

    it('ignores invalid custom patterns instead of throwing', () => {
      expect(() => shouldTriggerFallback({ statusCode: 403, code: 'X' }, config({ customErrorPatterns: ['[invalid', 'entitled'] }))).not.toThrow();
      expect(shouldTriggerFallback({ statusCode: 403, message: 'user entitled' }, config({ customErrorPatterns: ['[invalid', 'entitled'] }))).toBe(true);
    });

    it.each([
      null,
      new Error('User cancelled'),
      { statusCode: 401, message: 'Invalid API key' },
      { statusCode: 403, message: 'Invalid API key' },
      { statusCode: 500, message: 'Internal server error' },
      { responseBody: 'malformed json' },
    ])('ignores non-trigger error %j', (error) => {
      expect(shouldTriggerFallback(error, config())).toBe(false);
    });
  });
});
