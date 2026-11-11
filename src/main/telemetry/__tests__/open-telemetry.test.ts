import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTelemetry } from 'ai';
import { OpenTelemetry } from '@ai-sdk/otel';
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk';
import { NodeSDK } from '@opentelemetry/sdk-node';

import { initializeLangfuseSpanProcessor } from '../langfuse';
import { initializePostHogExporter } from '../posthog';

const { start, shutdown, processor, exporter } = vi.hoisted(() => ({
  start: vi.fn(),
  shutdown: vi.fn<() => Promise<void>>(),
  processor: { onStart: vi.fn(), onEnd: vi.fn(), shutdown: vi.fn(), forceFlush: vi.fn() },
  exporter: { export: vi.fn(), shutdown: vi.fn() },
}));

vi.mock('ai', () => ({ registerTelemetry: vi.fn() }));
vi.mock('@ai-sdk/otel', () => ({ OpenTelemetry: vi.fn(class {}) }));
vi.mock('@langfuse/vercel-ai-sdk', () => ({ LangfuseVercelAiSdkIntegration: vi.fn(class {}) }));
vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: vi.fn(
    class {
      start = start;
      shutdown = shutdown;
    },
  ),
}));
vi.mock('@opentelemetry/auto-instrumentations-node', () => ({ getNodeAutoInstrumentations: vi.fn(() => []) }));
vi.mock('../langfuse', () => ({ initializeLangfuseSpanProcessor: vi.fn() }));
vi.mock('../posthog', () => ({ initializePostHogExporter: vi.fn() }));
vi.mock('@/logger', () => ({ default: { info: vi.fn() } }));

describe('OpenTelemetry backend selection and lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(initializeLangfuseSpanProcessor).mockReturnValue(undefined);
    vi.mocked(initializePostHogExporter).mockReturnValue(undefined);
    shutdown.mockResolvedValue(undefined);
  });

  it('uses a Langfuse processor and exactly one Langfuse integration, taking precedence over PostHog', async () => {
    vi.mocked(initializeLangfuseSpanProcessor).mockReturnValue(processor);
    vi.mocked(initializePostHogExporter).mockReturnValue(exporter);

    await import('../open-telemetry');

    expect(NodeSDK).toHaveBeenCalledWith({ serviceName: 'aider-desk', spanProcessors: [processor], instrumentations: [[]] });
    expect(start).toHaveBeenCalledOnce();
    expect(initializePostHogExporter).not.toHaveBeenCalled();
    expect(LangfuseVercelAiSdkIntegration).toHaveBeenCalledOnce();
    expect(OpenTelemetry).not.toHaveBeenCalled();
    expect(registerTelemetry).toHaveBeenCalledExactlyOnceWith(vi.mocked(LangfuseVercelAiSdkIntegration).mock.instances[0]);
  });

  it('preserves the standard OpenTelemetry integration and exporter for PostHog', async () => {
    vi.mocked(initializePostHogExporter).mockReturnValue(exporter);

    await import('../open-telemetry');

    expect(NodeSDK).toHaveBeenCalledWith({ serviceName: 'aider-desk', traceExporter: exporter, instrumentations: [[]] });
    expect(start).toHaveBeenCalledOnce();
    expect(LangfuseVercelAiSdkIntegration).not.toHaveBeenCalled();
    expect(registerTelemetry).toHaveBeenCalledExactlyOnceWith(vi.mocked(OpenTelemetry).mock.instances[0]);
  });

  it('does not start an exporter without credentials and can safely shut down', async () => {
    const { shutdownOpenTelemetry } = await import('../open-telemetry');

    await shutdownOpenTelemetry();

    expect(NodeSDK).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
  });

  it('awaits the exporter flush and shares shutdown between concurrent and later callers', async () => {
    vi.mocked(initializeLangfuseSpanProcessor).mockReturnValue(processor);
    let finish!: () => void;
    shutdown.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const { shutdownOpenTelemetry } = await import('../open-telemetry');
    const finished = vi.fn();

    const first = shutdownOpenTelemetry();
    const second = shutdownOpenTelemetry();
    expect(first).toBe(second);
    const pending = first.then(finished);
    await vi.waitFor(() => expect(shutdown).toHaveBeenCalledOnce());
    expect(finished).not.toHaveBeenCalled();

    finish();
    await pending;
    expect(finished).toHaveBeenCalledOnce();
    expect(shutdownOpenTelemetry()).toBe(first);
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('propagates export shutdown failures to application cleanup', async () => {
    vi.mocked(initializePostHogExporter).mockReturnValue(exporter);
    const error = new Error('Failed to flush traces');
    shutdown.mockRejectedValue(error);
    const { shutdownOpenTelemetry } = await import('../open-telemetry');

    await expect(shutdownOpenTelemetry()).rejects.toThrow(error);
    expect(shutdown).toHaveBeenCalledOnce();
  });
});
