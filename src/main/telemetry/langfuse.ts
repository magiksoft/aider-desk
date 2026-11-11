import { LangfuseSpanProcessor } from '@langfuse/otel';

import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { SettingsData } from '@common/types';

import { getEffectiveEnvironmentVariable } from '@/utils/environment';
import logger from '@/logger';

export const initializeLangfuseSpanProcessor = (): SpanProcessor | undefined => {
  const langfusePublicKey = getEffectiveEnvironmentVariable('LANGFUSE_PUBLIC_KEY');
  const langfuseSecretKey = getEffectiveEnvironmentVariable('LANGFUSE_SECRET_KEY');
  const langfuseHost = getEffectiveEnvironmentVariable('LANGFUSE_HOST');

  if (langfusePublicKey && langfuseSecretKey) {
    logger.info('Initializing Langfuse Span Processor...');
    return new LangfuseSpanProcessor({
      publicKey: langfusePublicKey.value,
      secretKey: langfuseSecretKey.value,
      // @langfuse/otel appends /api/public/otel/v1/traces as-is; a trailing slash in LANGFUSE_HOST would give
      // a "//" path that Langfuse Cloud redirects (308) and the OTLP exporter does not follow.
      baseUrl: langfuseHost?.value.replace(/\/+$/, '') || 'https://cloud.langfuse.com',
    });
  }

  return undefined;
};

export const getLangfuseEnvironmentVariables = (baseDir: string, settings: SettingsData): Record<string, unknown> => {
  return {
    LANGFUSE_PUBLIC_KEY: getEffectiveEnvironmentVariable('LANGFUSE_PUBLIC_KEY', settings, baseDir)?.value,
    LANGFUSE_SECRET_KEY: getEffectiveEnvironmentVariable('LANGFUSE_SECRET_KEY', settings, baseDir)?.value,
    LANGFUSE_HOST: getEffectiveEnvironmentVariable('LANGFUSE_HOST', settings, baseDir)?.value,
  };
};
