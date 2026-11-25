import {
  APICallError,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4GenerateResult,
  type LanguageModelV4StreamPart,
  type LanguageModelV4StreamResult,
  type LanguageModelV4Usage,
} from '@ai-sdk/provider';

import { generateLoremText, parseLoremDirective } from './lorem.js';
import { createRng } from './random.js';
import { generateToolInput } from './tool-input.js';
import { DEFAULT_SCENARIOS, matchScenarioByKeywords, resolveScenarioId, scenarioFromSpecifier } from './scenarios.js';
import { estimateTokenCount, parseSpeedDirective, sleep, tokenize, DEFAULT_CHUNK_SIZE } from './speed.js';

import type { MockCallInfo, MockLoremOptions, MockPart, MockProviderOptions, MockScenario, MockScenarioContent } from './types.js';

type Prng = () => number;

export const resolveLoremParts = (scenario: MockScenario, userText: string): MockScenario => {
  if (!scenario.parts.some((part) => part.type === 'lorem')) {
    return scenario;
  }
  const directive = parseLoremDirective(userText);
  return {
    ...scenario,
    parts: scenario.parts.map((part) => (part.type === 'lorem' ? { ...part, unit: directive.unit ?? part.unit, count: directive.count ?? part.count } : part)),
  };
};

const clientFunctionTools = (options: LanguageModelV4CallOptions): Map<string, { name: string; inputSchema: unknown }> => {
  const tools = new Map<string, { name: string; inputSchema: unknown }>();
  for (const tool of options.tools ?? []) {
    if (tool.type === 'function') {
      tools.set(tool.name, tool);
    }
  }
  return tools;
};

export const resolveToolParts = (
  scenario: MockScenario,
  options: LanguageModelV4CallOptions,
  rng: Prng,
  toolInputs: Record<string, Record<string, unknown>> | undefined,
  queued: boolean,
  endsWithToolResult: boolean,
): MockScenario => {
  const toolChoice = options.toolChoice;
  const naturalFlow = toolChoice === undefined || toolChoice.type === 'auto' || toolChoice.type === 'none';
  const suppressToolCalls = toolChoice?.type === 'none' || (endsWithToolResult && !queued && naturalFlow);

  if (suppressToolCalls) {
    const hasToolParts = scenario.parts.some((part) => part.type === 'tool-call' || part.type === 'tool-result');
    return hasToolParts ? { ...scenario, parts: scenario.parts.filter((part) => part.type !== 'tool-call' && part.type !== 'tool-result') } : scenario;
  }

  const declaredTools = clientFunctionTools(options);
  const firstDeclared = declaredTools.keys().next().value;

  const resolveToolCallPart = (part: Extract<MockPart, { type: 'tool-call' }>): Extract<MockPart, { type: 'tool-call' }> => {
    let toolName = part.toolName;
    let input = part.input;
    const isDeclared = declaredTools.has(toolName);

    if (input === undefined) {
      if (!isDeclared && firstDeclared !== undefined) {
        toolName = toolChoice?.type === 'tool' ? toolChoice.toolName : firstDeclared;
      }
      input = toolInputs?.[toolName] ?? generateToolInput(declaredTools.get(toolName)?.inputSchema, rng);
    } else if (!isDeclared && firstDeclared !== undefined) {
      toolName = toolChoice?.type === 'tool' ? toolChoice.toolName : firstDeclared;
      input = toolInputs?.[toolName] ?? generateToolInput(declaredTools.get(toolName)?.inputSchema, rng);
    }
    return { type: 'tool-call', toolName, input };
  };

  let parts = scenario.parts.map((part) => (part.type === 'tool-call' ? resolveToolCallPart(part) : part));

  if (toolChoice?.type === 'tool') {
    const template = parts.find((part) => part.type === 'tool-call') as Extract<MockPart, { type: 'tool-call' }> | undefined;
    const chosenTool = declaredTools.get(toolChoice.toolName);
    const forcedPart: Extract<MockPart, { type: 'tool-call' }> = {
      type: 'tool-call',
      toolName: toolChoice.toolName,
      input:
        template?.input !== undefined && template.toolName === toolChoice.toolName
          ? template.input
          : (toolInputs?.[toolChoice.toolName] ?? generateToolInput(chosenTool?.inputSchema, rng)),
    };
    const firstToolCallIndex = parts.findIndex((part) => part.type === 'tool-call');
    parts =
      firstToolCallIndex === -1
        ? [forcedPart, ...parts]
        : parts
            .map((part, index) => (index === firstToolCallIndex ? forcedPart : part.type === 'tool-call' ? null : part))
            .filter((part): part is MockPart => part !== null);
  }

  if (toolChoice?.type === 'required' && !parts.some((part) => part.type === 'tool-call')) {
    const toolName = firstDeclared ?? 'mock_tool';
    parts = [...parts, { type: 'tool-call', toolName, input: toolInputs?.[toolName] ?? generateToolInput(declaredTools.get(toolName)?.inputSchema, rng) }];
  }

  return parts === scenario.parts ? scenario : { ...scenario, parts };
};

export const renderScenarioText = (scenario: MockScenario, rng: Prng, loremOptions?: MockLoremOptions): string =>
  scenario.parts
    .filter(
      (part): part is { type: 'text'; text: string } | { type: 'lorem'; unit: 'words' | 'sentences' | 'paragraphs'; count: number } =>
        part.type === 'text' || part.type === 'lorem',
    )
    .map((part) => (part.type === 'text' ? part.text : generateLoremText(part, rng, loremOptions)))
    .join('\n\n');

const TEXT_CHUNK_SIZE_TOKEN_OVERHEAD = 1;

type ResolvedResponse = {
  scenario: MockScenario;
  tokensPerSecond: number;
  firstTokenDelayMs: number;
};

const messageText = (content: string | ReadonlyArray<{ type: string; text?: string }>): string => {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join(' ');
};

const lastUserText = (options: LanguageModelV4CallOptions): string => {
  for (let index = options.prompt.length - 1; index >= 0; index--) {
    const message = options.prompt[index];
    if (message.role !== 'user') {
      continue;
    }
    return messageText(message.content);
  }
  return '';
};

const countPromptTokens = (options: LanguageModelV4CallOptions, chunkSize: number): number =>
  options.prompt.reduce((total, message) => total + estimateTokenCount(messageText(message.content), chunkSize), 0);

const createUsage = (inputTokens: number, textTokens: number, reasoningTokens: number): LanguageModelV4Usage => ({
  inputTokens: {
    total: inputTokens,
    noCache: inputTokens,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: textTokens + reasoningTokens,
    text: textTokens,
    reasoning: reasoningTokens,
  },
});

const finishReason = (unified: string) => ({
  unified: unified as 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'interrupted' | 'other',
  raw: unified,
});

const errorToThrow = (message: string) =>
  new APICallError({
    message,
    url: 'mock://ai-mock-provider',
    requestBodyValues: undefined,
    statusCode: 500,
    isRetryable: false,
  });

export class MockLanguageModelV4 implements LanguageModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly provider = 'ai-mock-provider';
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  calls: MockCallInfo[] = [];

  private readonly scenarios: MockScenario[];
  private readonly responseQueue: (string | MockScenarioContent)[];
  private readonly defaultTokensPerSecond: number;
  private readonly defaultFirstTokenDelayMs: number;
  private readonly chunkSize: number;
  private readonly defaultScenarioId: string;
  private readonly rng: Prng;
  private readonly loremOptions: MockLoremOptions | undefined;
  private readonly toolInputs: Record<string, Record<string, unknown>> | undefined;
  private callIndex = 0;

  constructor(modelId: string, options: MockProviderOptions = {}, rng?: Prng) {
    this.modelId = modelId;
    this.rng = rng ?? createRng(options.seed);
    this.loremOptions = options.lorem;
    this.toolInputs = options.toolInputs;
    this.defaultTokensPerSecond = options.tokensPerSecond ?? 0;
    this.defaultFirstTokenDelayMs = options.firstTokenDelayMs ?? 0;
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.defaultScenarioId = options.defaultScenario ?? 'default';
    this.responseQueue = [...(options.responses ?? [])];

    const customScenarios = Object.entries(options.scenarios ?? {}).map(([id, specifier]) => scenarioFromSpecifier(id, specifier));
    this.scenarios = [
      ...DEFAULT_SCENARIOS.map((scenario) => ({ ...scenario })),
      ...customScenarios.filter((custom) => !DEFAULT_SCENARIOS.some((scenario) => scenario.id === custom.id)),
    ];
    for (const custom of customScenarios) {
      const builtin = this.scenarios.find((scenario) => scenario.id === custom.id);
      if (builtin) {
        Object.assign(builtin, custom, { id: custom.id });
      }
    }
  }

  private resolveResponse(options: LanguageModelV4CallOptions): ResolvedResponse {
    const userText = lastUserText(options);
    const { tokensPerSecond: promptSpeed, cleanedText } = parseSpeedDirective(userText);

    let scenario: MockScenario | undefined;
    const queuedSpecifier: string | MockScenarioContent | undefined = this.responseQueue.shift();
    const queued = queuedSpecifier !== undefined;

    if (queuedSpecifier !== undefined) {
      const specifierId = typeof queuedSpecifier === 'string' ? queuedSpecifier : undefined;
      scenario =
        specifierId !== undefined
          ? (this.scenarios.find((candidate) => candidate.id === specifierId) ?? scenarioFromSpecifier(specifierId, specifierId))
          : scenarioFromSpecifier(`response-${this.callIndex}`, queuedSpecifier);
    }

    if (!scenario) {
      const scenarioId = resolveScenarioId(this.modelId, this.scenarios);
      scenario = scenarioId ? this.scenarios.find((candidate) => candidate.id === scenarioId) : undefined;
    }

    if (!scenario) {
      scenario = matchScenarioByKeywords(cleanedText, this.scenarios);
    }

    if (!scenario && options.responseFormat?.type === 'json') {
      scenario = this.scenarios.find((candidate) => candidate.id === 'json');
    }

    if (!scenario) {
      const fallbackId = this.scenarios.some((candidate) => candidate.id === this.defaultScenarioId) ? this.defaultScenarioId : 'default';
      scenario = this.scenarios.find((candidate) => candidate.id === fallbackId) ?? this.scenarios[this.scenarios.length - 1];
    }

    scenario = resolveLoremParts(scenario, userText);
    const endsWithToolResult = options.prompt[options.prompt.length - 1]?.role === 'tool';
    scenario = resolveToolParts(scenario, options, this.rng, this.toolInputs, queued, endsWithToolResult);

    const tokensPerSecond = promptSpeed ?? scenario.tokensPerSecond ?? this.defaultTokensPerSecond;
    const firstTokenDelayMs = scenario.firstTokenDelayMs ?? this.defaultFirstTokenDelayMs;

    this.callIndex++;
    this.calls.push({
      modelId: this.modelId,
      scenarioId: scenario.id,
      prompt: userText,
      tokensPerSecond,
      firstTokenDelayMs,
      timestamp: new Date(),
    });

    return { scenario, tokensPerSecond, firstTokenDelayMs };
  }

  async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    const { scenario } = this.resolveResponse(options);

    const errorPart = scenario.parts.find((part) => part.type === 'error');
    if (errorPart && errorPart.type === 'error') {
      throw errorToThrow(errorPart.message);
    }

    const promptTokens = countPromptTokens(options, this.chunkSize);
    const content: LanguageModelV4GenerateResult['content'] = [];
    let textTokens = 0;
    let reasoningTokens = 0;

    for (const part of scenario.parts) {
      if (part.type === 'text') {
        content.push({ type: 'text', text: part.text });
        textTokens += estimateTokenCount(part.text, this.chunkSize);
      } else if (part.type === 'lorem') {
        const text = generateLoremText(part, this.rng, this.loremOptions);
        content.push({ type: 'text', text });
        textTokens += estimateTokenCount(text, this.chunkSize);
      } else if (part.type === 'reasoning') {
        content.push({ type: 'reasoning', text: part.text });
        reasoningTokens += estimateTokenCount(part.text, this.chunkSize);
      } else if (part.type === 'tool-call') {
        const toolCallId = `mock-call-${content.length}`;
        const inputJson = JSON.stringify(part.input);
        content.push({
          type: 'tool-call',
          toolCallId,
          toolName: part.toolName,
          input: inputJson,
        });
        textTokens += estimateTokenCount(inputJson, this.chunkSize);
      } else if (part.type === 'tool-result') {
        const pairedCall = [...content].reverse().find((entry) => entry.type === 'tool-call' && entry.toolName === part.toolName);
        const toolCallId = pairedCall?.type === 'tool-call' ? pairedCall.toolCallId : `mock-call-${content.length}`;
        content.push({
          type: 'tool-result',
          toolCallId,
          toolName: part.toolName,
          result: (part.result ?? { ok: true }) as never,
          ...(part.isError !== undefined ? { isError: part.isError } : {}),
        });
      } else if (part.type === 'file') {
        content.push({ type: 'file', mediaType: part.mediaType, data: { type: 'data', data: part.data } });
      }
    }

    return {
      content,
      warnings: [],
      finishReason: finishReason(scenario.finishReason),
      usage: createUsage(promptTokens, textTokens, reasoningTokens),
    };
  }

  async doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    const { scenario, tokensPerSecond, firstTokenDelayMs } = this.resolveResponse(options);

    const streamParams: StreamParams = {
      modelId: this.modelId,
      callIndex: this.callIndex,
      options,
      scenario,
      tokensPerSecond,
      firstTokenDelayMs,
      chunkSize: this.chunkSize,
      rng: this.rng,
      loremOptions: this.loremOptions,
    };

    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      async start(controller) {
        try {
          for await (const part of streamParts(streamParams)) {
            controller.enqueue(part);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return { stream };
  }
}

const capTokenCount = (chunks: string[], maxOutputTokens: number | undefined): { chunks: string[]; truncated: boolean } => {
  if (maxOutputTokens === undefined || chunks.length <= maxOutputTokens) {
    return { chunks, truncated: false };
  }
  return { chunks: chunks.slice(0, maxOutputTokens), truncated: true };
};

const partIndex = (scenario: MockScenario, part: unknown): number => scenario.parts.indexOf(part as never);

type StreamParams = {
  modelId: string;
  callIndex: number;
  options: LanguageModelV4CallOptions;
  scenario: MockScenario;
  tokensPerSecond: number;
  firstTokenDelayMs: number;
  chunkSize: number;
  rng: Prng;
  loremOptions?: MockLoremOptions;
};

const streamParts = async function* (params: StreamParams): AsyncGenerator<LanguageModelV4StreamPart> {
  const { modelId, callIndex, options, scenario, tokensPerSecond, firstTokenDelayMs, chunkSize } = params;
  const abortSignal = options.abortSignal;
  const interChunkDelayMs = tokensPerSecond > 0 ? 1000 / tokensPerSecond : 0;
  const counters = { text: 0, reasoning: 0 };

  yield { type: 'stream-start', warnings: [] };
  yield {
    type: 'response-metadata',
    id: `mock-${modelId}-${callIndex}`,
    timestamp: new Date(),
    modelId,
  };

  if (firstTokenDelayMs > 0) {
    await sleep(firstTokenDelayMs, abortSignal);
    if (abortSignal?.aborted) {
      return;
    }
  }

  const maxOutputTokens = options.maxOutputTokens;
  let finishReasonUnified: 'stop' | 'length' | 'tool-calls' =
    scenario.finishReason === 'length' ? 'length' : scenario.finishReason === 'tool-calls' ? 'tool-calls' : 'stop';

  for (const part of scenario.parts) {
    if (abortSignal?.aborted) {
      return;
    }

    if (part.type === 'error') {
      yield { type: 'error', error: errorToThrow(part.message) };
      return;
    }

    if (part.type === 'text' || part.type === 'lorem') {
      const text = part.type === 'text' ? part.text : generateLoremText(part, params.rng, params.loremOptions);
      const { chunks, truncated } = capTokenCount(tokenize(text, chunkSize), maxOutputTokens);
      const textId = `text-${partIndex(scenario, part)}`;
      yield { type: 'text-start', id: textId };
      for (const chunk of chunks) {
        if (abortSignal?.aborted) {
          return;
        }
        await sleep(interChunkDelayMs, abortSignal);
        counters.text += TEXT_CHUNK_SIZE_TOKEN_OVERHEAD;
        yield { type: 'text-delta', id: textId, delta: chunk };
      }
      yield { type: 'text-end', id: textId };
      if (truncated) {
        finishReasonUnified = 'length';
      }
    } else if (part.type === 'reasoning') {
      const chunks = tokenize(part.text, chunkSize);
      const reasoningId = `reasoning-${partIndex(scenario, part)}`;
      yield { type: 'reasoning-start', id: reasoningId };
      for (const chunk of chunks) {
        if (abortSignal?.aborted) {
          return;
        }
        await sleep(interChunkDelayMs, abortSignal);
        counters.reasoning += TEXT_CHUNK_SIZE_TOKEN_OVERHEAD;
        yield { type: 'reasoning-delta', id: reasoningId, delta: chunk };
      }
      yield { type: 'reasoning-end', id: reasoningId };
    } else if (part.type === 'tool-call') {
      const toolCallId = `tool-${partIndex(scenario, part)}`;
      const inputJson = JSON.stringify(part.input ?? {});
      yield { type: 'tool-input-start', id: toolCallId, toolName: part.toolName };
      const inputChunks = tokenize(inputJson, chunkSize);
      for (const chunk of inputChunks) {
        if (abortSignal?.aborted) {
          return;
        }
        await sleep(interChunkDelayMs, abortSignal);
        yield { type: 'tool-input-delta', id: toolCallId, delta: chunk };
      }
      yield { type: 'tool-input-end', id: toolCallId };
      yield {
        type: 'tool-call',
        toolCallId,
        toolName: part.toolName,
        input: inputJson,
      };
      counters.text += TEXT_CHUNK_SIZE_TOKEN_OVERHEAD;
    } else if (part.type === 'tool-result') {
      const resultIndex = partIndex(scenario, part);
      let pairedIndex = resultIndex - 1;
      while (pairedIndex >= 0 && scenario.parts[pairedIndex].type !== 'tool-call') {
        pairedIndex--;
      }
      const toolCallId = `tool-${pairedIndex >= 0 ? pairedIndex : resultIndex}`;
      yield {
        type: 'tool-result',
        toolCallId,
        toolName: part.toolName,
        result: (part.result ?? { ok: true }) as never,
        ...(part.isError !== undefined ? { isError: part.isError } : {}),
      };
    } else if (part.type === 'file') {
      yield { type: 'file', mediaType: part.mediaType, data: { type: 'data', data: part.data } };
    }
  }

  if (abortSignal?.aborted) {
    return;
  }

  yield {
    type: 'finish',
    finishReason: finishReason(finishReasonUnified),
    usage: createUsage(countPromptTokens(options, chunkSize), counters.text, counters.reasoning),
  };
};
