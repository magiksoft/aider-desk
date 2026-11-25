import type { Prng } from './random.js';

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  examples?: unknown[];
  format?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  additionalProperties?: unknown;
};

const STRING_HINTS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /city/i, value: 'San Francisco' },
  { pattern: /country/i, value: 'United States' },
  { pattern: /(first[_-]?name)/i, value: 'Ada' },
  { pattern: /(last[_-]?name|surname)/i, value: 'Lovelace' },
  { pattern: /(full[_-]?name|^name$|[_-]name$)/i, value: 'Ada Lovelace' },
  { pattern: /(lang|locale)/i, value: 'en' },
  { pattern: /currency/i, value: 'USD' },
  { pattern: /timezone/i, value: 'America/Los_Angeles' },
];

const clamp = (value: number, min: number | undefined, max: number | undefined): number => {
  let result = value;
  if (min !== undefined) {
    result = Math.max(result, min);
  }
  if (max !== undefined) {
    result = Math.min(result, max);
  }
  return result;
};

const generateString = (schema: JsonSchema, propertyName: string, rng: Prng): string => {
  switch (schema.format) {
    case 'email':
      return 'ada.lovelace@example.com';
    case 'uri':
    case 'url':
      return 'https://example.com/mock-resource';
    case 'date':
      return new Date().toISOString().slice(0, 10);
    case 'date-time':
      return new Date().toISOString();
    case 'uuid':
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
        const random = Math.floor(rng() * 16);
        const value = char === 'x' ? random : (random & 0x3) | 0x8;
        return value.toString(16);
      });
    default:
      break;
  }

  const hint = STRING_HINTS.find(({ pattern }) => pattern.test(propertyName));
  const minLength = schema.minLength ?? 1;
  let value = hint?.value ?? 'mock string value';
  while (value.length < minLength) {
    value = `${value} filler`;
  }
  if (schema.maxLength !== undefined) {
    value = value.slice(0, schema.maxLength);
  }
  if (value === hint?.value && rng() < 0.5) {
    return value;
  }
  return value;
};

const generateNumber = (schema: JsonSchema, rng: Prng, integer: boolean): number => {
  const min = schema.minimum ?? schema.exclusiveMinimum ?? -100;
  const max = schema.maximum ?? schema.exclusiveMaximum ?? 100;
  const span = Math.max(max - min, 1);
  const raw = min + rng() * span;
  const bounded = clamp(raw, schema.minimum, schema.maximum);
  return integer ? Math.round(bounded) : Math.round(bounded * 100) / 100;
};

const generateValue = (schema: JsonSchema, propertyName: string, rng: Prng): unknown => {
  if (schema.const !== undefined) {
    return schema.const;
  }
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[Math.floor(rng() * schema.enum.length)];
  }
  if (schema.default !== undefined) {
    return schema.default;
  }
  if (schema.examples && schema.examples.length > 0) {
    return schema.examples[Math.floor(rng() * schema.examples.length)];
  }
  const branch = schema.anyOf ?? schema.oneOf;
  if (branch && branch.length > 0) {
    const nullable = branch.find((candidate) => candidate.type === 'null');
    const candidate = nullable && branch.length > 1 ? branch.filter((item) => item !== nullable)[0] : branch[0];
    return generateValue(candidate, propertyName, rng);
  }

  const schemaType = Array.isArray(schema.type) ? (schema.type.find((type) => type !== 'null') ?? schema.type[0]) : schema.type;

  switch (schemaType) {
    case 'string':
      return generateString(schema, propertyName, rng);
    case 'number':
      return generateNumber(schema, rng, false);
    case 'integer':
      return generateNumber(schema, rng, true);
    case 'boolean':
      return rng() < 0.5;
    case 'array': {
      const itemCount = schema.minItems ?? 1;
      return Array.from({ length: Math.max(itemCount, 1) }, () => (schema.items ? generateValue(schema.items, propertyName, rng) : 'mock item'));
    }
    case 'object':
      return schema.properties ? generateObject(schema, rng) : {};
    default:
      return null;
  }
};

const generateObject = (schema: JsonSchema, rng: Prng): Record<string, unknown> => {
  if (!schema.properties) {
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
    result[propertyName] = generateValue(propertySchema, propertyName, rng);
  }
  for (const requiredProperty of schema.required ?? []) {
    if (!(requiredProperty in result)) {
      result[requiredProperty] = generateValue({ type: 'string' }, requiredProperty, rng);
    }
  }
  return result;
};

export const generateToolInput = (schema: unknown, rng: Prng): Record<string, unknown> => {
  if (!schema || typeof schema !== 'object') {
    return {};
  }
  return generateObject(schema as JsonSchema, rng);
};

export const generateToolResult = (toolName: string, rng: Prng): Record<string, unknown> => ({
  toolName,
  executedAt: new Date().toISOString(),
  status: rng() < 0.5 ? 'completed' : 'pending',
  output: `mock result for ${toolName}`,
});
