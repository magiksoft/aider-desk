import { createServer, type Server } from 'node:http';

import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeLangfuseSpanProcessor } from '../langfuse';

import type { AddressInfo } from 'node:net';

import { getEffectiveEnvironmentVariable } from '@/utils/environment';

vi.mock('@/utils/environment', () => ({ getEffectiveEnvironmentVariable: vi.fn() }));
vi.mock('@/logger', () => ({ default: { info: vi.fn() } }));

type ReceivedRequest = { url: string; status: number };

// Exports real spans through @langfuse/otel to a local server that answers like Langfuse Cloud:
// a "//" path gets a 308 redirect, which the OTLP exporter does not follow, so those spans are lost.
describe('Langfuse span export', () => {
  let server: Server;
  let host: string;
  let requests: ReceivedRequest[];

  beforeEach(async () => {
    requests = [];
    server = createServer((req, res) => {
      const url = req.url ?? '';
      const status = url.startsWith('//') ? 308 : 200;
      requests.push({ url, status });
      req.resume();
      req.on('end', () => {
        res.writeHead(status, status === 308 ? { Location: url.replace(/^\/+/, '/') } : { 'Content-Type': 'application/json' });
        res.end(status === 308 ? '' : '{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each(['', '/', '//'])('delivers AI SDK spans when LANGFUSE_HOST ends with "%s"', async (suffix) => {
    const variables: Record<string, string> = {
      LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
      LANGFUSE_SECRET_KEY: 'sk-lf-test',
      LANGFUSE_HOST: `${host}${suffix}`,
    };
    vi.mocked(getEffectiveEnvironmentVariable).mockImplementation((key) =>
      variables[key] === undefined ? undefined : { value: variables[key], source: 'test' },
    );
    const spanProcessor = initializeLangfuseSpanProcessor();
    expect(spanProcessor).toBeDefined();
    const provider = new BasicTracerProvider({ spanProcessors: spanProcessor ? [spanProcessor] : [] });

    provider.getTracer('ai').startSpan('ai.generateText').end();
    await provider.forceFlush();
    await provider.shutdown();

    expect(requests).toEqual([{ url: '/api/public/otel/v1/traces', status: 200 }]);
  });
});
