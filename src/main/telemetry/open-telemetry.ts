import { registerTelemetry } from 'ai';
import { OpenTelemetry } from '@ai-sdk/otel';
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

import { initializeLangfuseSpanProcessor } from './langfuse';
import { initializePostHogExporter } from './posthog';

import logger from '@/logger';

const langfuseSpanProcessor = initializeLangfuseSpanProcessor();
const traceExporter = langfuseSpanProcessor ? undefined : initializePostHogExporter();
let sdk: NodeSDK | undefined;
let shutdownPromise: Promise<void> | undefined;

if (langfuseSpanProcessor || traceExporter) {
  logger.info('Initializing OpenTelemetry...');

  sdk = new NodeSDK({
    serviceName: 'aider-desk',
    logRecordProcessors: [],
    metricReaders: [],
    ...(langfuseSpanProcessor ? { spanProcessors: [langfuseSpanProcessor] } : { traceExporter }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  logger.info('OpenTelemetry initialized.');
}

registerTelemetry(langfuseSpanProcessor ? new LangfuseVercelAiSdkIntegration() : new OpenTelemetry());

export const shutdownOpenTelemetry = (): Promise<void> => {
  shutdownPromise ??= Promise.resolve().then(async () => {
    if (sdk) {
      await sdk.shutdown();
      logger.info('OpenTelemetry SDK terminated');
    }
  });
  return shutdownPromise;
};
