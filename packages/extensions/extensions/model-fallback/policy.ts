export type ModelFallbackConfig = {
  enabled: boolean;
  fallbackModelId: string;
  customErrorCodes: string[];
  customErrorPatterns: string[];
};

export type ModelSelection = {
  providerId: string;
  modelId: string;
};

export const DEFAULT_MODEL_FALLBACK_CONFIG: ModelFallbackConfig = {
  enabled: true,
  fallbackModelId: '',
  customErrorCodes: [],
  customErrorPatterns: [],
};

const QUOTA_CODES = new Set([
  'entitlement_error',
  'insufficient_quota',
  'quota_exceeded',
  'rate_limit_exceeded',
  'rate_limit_error',
  'resource_exhausted',
]);

const QUOTA_MESSAGE_PATTERN =
  /\b(?:quota|rate.?limit|usage.?limit|request.?limit|token.?limit|insufficient\s+(?:credits?|balance)|credits?\s+exhausted|resource\s+exhausted|billing\s+(?:hard\s+)?limit|entitlement|subscribed|subscription)/i;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const hasQuotaCode = (value: unknown): boolean =>
  typeof value === 'string' && QUOTA_CODES.has(value.toLowerCase());

const hasQuotaMessage = (value: unknown): boolean =>
  typeof value === 'string' && QUOTA_MESSAGE_PATTERN.test(value);

const hasCustomCode = (value: unknown, codes: ReadonlySet<string>): boolean =>
  typeof value === 'string' && codes.has(value.toLowerCase());

const hasCustomMessage = (value: unknown, patterns: readonly RegExp[]): boolean =>
  typeof value === 'string' && patterns.some((pattern) => pattern.test(value));

const compileErrorPatterns = (patterns: readonly string[]): RegExp[] =>
  patterns.flatMap((pattern) => {
    try {
      return [new RegExp(pattern, 'i')];
    } catch {
      return [];
    }
  });

const parseStringList = (value: unknown): string[] => {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('Invalid Model Fallback configuration. Expected arrays of strings for customErrorCodes and customErrorPatterns.');
  }
  return (value as string[]).map((item) => item.trim()).filter((item) => item !== '');
};

export const parseModelSelection = (value: unknown): ModelSelection | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  const separatorIndex = trimmed.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1 || /\s/.test(trimmed)) {
    return null;
  }
  return {
    providerId: trimmed.slice(0, separatorIndex),
    modelId: trimmed.slice(separatorIndex + 1),
  };
};

export const parseModelFallbackConfig = (value: unknown): ModelFallbackConfig => {
  const data = asRecord(value);
  if (!data) {
    throw new Error('Model Fallback configuration must be an object.');
  }

  const enabled = data.enabled ?? DEFAULT_MODEL_FALLBACK_CONFIG.enabled;
  const fallbackModelId = data.fallbackModelId ?? DEFAULT_MODEL_FALLBACK_CONFIG.fallbackModelId;
  if (
    typeof enabled !== 'boolean' ||
    typeof fallbackModelId !== 'string' ||
    (fallbackModelId !== '' && !parseModelSelection(fallbackModelId))
  ) {
    throw new Error('Invalid Model Fallback configuration. Expected enabled and fallbackModelId.');
  }

  const customErrorCodes = [...new Set(parseStringList(data.customErrorCodes).map((code) => code.toLowerCase()))];
  const customErrorPatterns = parseStringList(data.customErrorPatterns);
  for (const pattern of customErrorPatterns) {
    try {
      new RegExp(pattern);
    } catch {
      throw new Error(`Invalid Model Fallback configuration. customErrorPatterns contains an invalid regular expression: ${pattern}`);
    }
  }

  return { enabled, fallbackModelId, customErrorCodes, customErrorPatterns };
};

export const shouldTriggerFallback = (error: unknown, config: ModelFallbackConfig): boolean => {
  const customCodes = new Set(config.customErrorCodes.map((code) => code.toLowerCase()));
  const customPatterns = compileErrorPatterns(config.customErrorPatterns);

  const seen = new Set<unknown>();
  const pending: unknown[] = [error];

  while (pending.length > 0 && seen.size < 16) {
    const current = pending.pop();
    const record = asRecord(current);
    if (!record || seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (
      record.statusCode === 429 ||
      hasQuotaCode(record.code) ||
      hasQuotaCode(record.type) ||
      hasCustomCode(record.code, customCodes) ||
      hasCustomCode(record.type, customCodes) ||
      hasQuotaMessage(record.message) ||
      hasCustomMessage(record.message, customPatterns)
    ) {
      return true;
    }

    pending.push(record.lastError, record.cause, record.error, record.data);

    if (typeof record.responseBody === 'string') {
      if (hasQuotaMessage(record.responseBody) || hasCustomMessage(record.responseBody, customPatterns)) {
        return true;
      }
      try {
        pending.push(JSON.parse(record.responseBody));
      } catch {
        // Ignore non-JSON response bodies
      }
    }
  }

  return false;
};
