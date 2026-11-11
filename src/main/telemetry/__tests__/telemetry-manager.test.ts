import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TelemetryManager } from '../telemetry-manager';

import type { Store } from '@/store';
import type { ModelManager } from '@/models/model-manager';

const { shutdownOpenTelemetry, shutdownPostHog, identify, config } = vi.hoisted(() => ({
  shutdownOpenTelemetry: vi.fn<() => Promise<void>>(),
  shutdownPostHog: vi.fn<() => Promise<void>>(),
  identify: vi.fn(),
  config: { publicApiKey: '' },
}));

vi.mock('../open-telemetry', () => ({ shutdownOpenTelemetry }));
vi.mock('posthog-node', () => ({
  PostHog: vi.fn(
    class {
      shutdown = shutdownPostHog;
      identify = identify;
    },
  ),
}));
vi.mock('@/constants', () => ({
  get POSTHOG_PUBLIC_API_KEY() {
    return config.publicApiKey;
  },
  POSTHOG_HOST: 'https://us.i.posthog.com',
  APP_TYPE: 'test',
  PRODUCT_TELEMETRY_DISTINCT_ID: 'product',
}));
vi.mock('@/app', () => ({ getElectronApp: vi.fn() }));
vi.mock('@/store', () => ({ Store: vi.fn() }));
vi.mock('@/logger', () => ({ default: { info: vi.fn(), error: vi.fn() } }));

const createManager = () => new TelemetryManager({ getUserId: () => 'test-user' } as Store, {} as ModelManager);

describe('TelemetryManager tracing cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.publicApiKey = '';
    shutdownOpenTelemetry.mockResolvedValue(undefined);
    shutdownPostHog.mockResolvedValue(undefined);
  });

  it('flushes tracing when product analytics is not configured', async () => {
    const manager = createManager();
    await manager.init();

    await manager.destroy();

    expect(shutdownOpenTelemetry).toHaveBeenCalledOnce();
    expect(shutdownPostHog).not.toHaveBeenCalled();
  });

  it('flushes tracing even if product analytics shutdown fails', async () => {
    config.publicApiKey = 'product-key';
    const manager = createManager();
    await manager.init();
    const error = new Error('PostHog shutdown failed');
    shutdownPostHog.mockRejectedValue(error);

    await expect(manager.destroy()).rejects.toThrow(error);

    expect(shutdownOpenTelemetry).toHaveBeenCalledOnce();
  });

  it('does not initialize tracing when destroyed before initialization', async () => {
    await createManager().destroy();

    expect(shutdownOpenTelemetry).not.toHaveBeenCalled();
  });

  it('waits for trace flushing before destruction finishes', async () => {
    let finish!: () => void;
    shutdownOpenTelemetry.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const manager = createManager();
    await manager.init();
    const finished = vi.fn();

    const pending = manager.destroy().then(finished);
    await vi.waitFor(() => expect(shutdownOpenTelemetry).toHaveBeenCalledOnce());
    expect(finished).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(finished).toHaveBeenCalledOnce();
  });
});
