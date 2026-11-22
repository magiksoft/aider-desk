import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ModelFallbackExtension from '../index';

import type { AgentStepFinishedEvent, ExtensionContext } from '@aiderdesk/extensions';

const createEvent = (overrides: Partial<AgentStepFinishedEvent> = {}): AgentStepFinishedEvent =>
  ({
    mode: 'agent',
    agentProfile: { id: 'agent-1', provider: 'primary', model: 'primary-model' },
    providerId: 'primary',
    model: 'primary-model',
    currentResponseId: 'resp-1',
    iterationCount: 1,
    retryCount: 0,
    error: { statusCode: 429 },
    hasOutput: false,
    hasToolCalls: false,
    finishReason: 'error',
    responseMessages: [],
    ...overrides,
  }) as AgentStepFinishedEvent;

describe('ModelFallbackExtension', () => {
  let tempDir: string;
  let configPath: string;
  let extension: ModelFallbackExtension;
  let context: ExtensionContext;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'model-fallback-'));
    configPath = join(tempDir, 'config.json');
    extension = new ModelFallbackExtension(configPath);
    context = {
      log: vi.fn(),
      getProviders: vi.fn(() => [
        { id: 'primary', name: 'Primary', disabled: false },
        { id: 'backup', name: 'Backup', disabled: false },
        { id: 'disabled-provider', name: 'Disabled', disabled: true },
      ]),
    } as unknown as ExtensionContext;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('requests continuation with the configured fallback model on a safe quota error', async () => {
    await extension.saveConfigData({ enabled: true, fallbackModelId: 'backup/group/model' });

    const result = await extension.onAgentStepFinished(createEvent(), context);

    expect(result).toEqual({ continue: true, modelId: 'backup/group/model' });
  });

  it('requests continuation for built-in subscription/entitlement errors', async () => {
    await extension.saveConfigData({ enabled: true, fallbackModelId: 'backup/model' });

    const entitlementEvent = createEvent({
      error: {
        statusCode: 403,
        message:
          'Error 403: the user is not subscribed to required model plan: {"error":{"code":"ENTITLEMENT_ERROR","message":"Error 403: the user is not subscribed to required model plan"}}',
      },
    });
    await expect(extension.onAgentStepFinished(entitlementEvent, context)).resolves.toEqual({
      continue: true,
      modelId: 'backup/model',
    });
  });

  it('requests continuation for configured custom error codes and patterns only', async () => {
    await extension.saveConfigData({
      enabled: true,
      fallbackModelId: 'backup/model',
      customErrorCodes: ['PLAN_REQUIRED'],
      customErrorPatterns: ['not entitled to'],
    });

    await expect(
      extension.onAgentStepFinished(createEvent({ error: { statusCode: 403, type: 'plan_required' } }), context),
    ).resolves.toEqual({ continue: true, modelId: 'backup/model' });
    await expect(
      extension.onAgentStepFinished(createEvent({ error: { statusCode: 403, message: 'user not entitled to this model' } }), context),
    ).resolves.toEqual({ continue: true, modelId: 'backup/model' });

    await expect(
      extension.onAgentStepFinished(createEvent({ error: { statusCode: 403, message: 'Invalid API key' } }), context),
    ).resolves.toBeUndefined();
  });

  it('does not switch when the step had no error, already emitted output, or started tools', async () => {
    await extension.saveConfigData({ enabled: true, fallbackModelId: 'backup/model' });

    await expect(extension.onAgentStepFinished(createEvent({ error: undefined, finishReason: 'stop' }), context)).resolves.toBeUndefined();
    await expect(extension.onAgentStepFinished(createEvent({ hasOutput: true }), context)).resolves.toBeUndefined();
    await expect(extension.onAgentStepFinished(createEvent({ hasToolCalls: true }), context)).resolves.toBeUndefined();
  });

  it('does not switch when already on the fallback model, disabled, or another extension handled the event', async () => {
    await extension.saveConfigData({ enabled: true, fallbackModelId: 'backup/model' });

    await expect(extension.onAgentStepFinished(createEvent({ providerId: 'backup', model: 'model' }), context)).resolves.toBeUndefined();
    await expect(extension.onAgentStepFinished(createEvent({ continue: true }), context)).resolves.toBeUndefined();
    await expect(extension.onAgentStepFinished(createEvent({ modelId: 'other/model' }), context)).resolves.toBeUndefined();

    await extension.saveConfigData({ enabled: false, fallbackModelId: 'backup/model' });
    await expect(extension.onAgentStepFinished(createEvent(), context)).resolves.toBeUndefined();
  });

  it('does not switch when the configured fallback provider is disabled or missing', async () => {
    await extension.saveConfigData({ enabled: true, fallbackModelId: 'disabled-provider/model' });
    await expect(extension.onAgentStepFinished(createEvent(), context)).resolves.toBeUndefined();

    await extension.saveConfigData({ enabled: true, fallbackModelId: 'missing/model' });
    await expect(extension.onAgentStepFinished(createEvent(), context)).resolves.toBeUndefined();
  });

  it('falls back to default config when config.json is missing or corrupt', async () => {
    await expect(extension.getConfigData(context)).resolves.toEqual({
      enabled: true,
      fallbackModelId: '',
      customErrorCodes: [],
      customErrorPatterns: [],
    });

    await writeFile(configPath, '{invalid', 'utf-8');
    await expect(extension.getConfigData(context)).resolves.toEqual({
      enabled: true,
      fallbackModelId: '',
      customErrorCodes: [],
      customErrorPatterns: [],
    });
  });

  it('returns the settings ConfigComponent JSX string', () => {
    expect(extension.getConfigComponent()).toContain('ModelSelector');
  });

  it('defaults config.json storage inside the extension module directory', () => {
    const defaultExtension = new ModelFallbackExtension();
    const expectedPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config.json');

    expect(defaultExtension.configPath).toBe(expectedPath);
  });
});
