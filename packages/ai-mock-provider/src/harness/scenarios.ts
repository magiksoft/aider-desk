import { generateObject, generateText, stepCountIs, streamText, tool, jsonSchema } from 'ai';

import { createMockProvider } from '../index.js';

import type { MockLanguageModel } from '../types.js';

export type HarnessResult = {
  name: string;
  passed: boolean;
  details: string;
  durationMs: number;
};

type HarnessCheck = () => Promise<string>;

const MAX_TOKENS_PER_SECOND = 0;
const SPEED_TOLERANCE = 0.25;

const collectFullStream = async (result: ReturnType<typeof streamText>) => {
  const parts: Array<{ type: string; text?: string; delta?: string }> = [];
  for await (const part of result.fullStream) {
    parts.push(part as { type: string; text?: string; delta?: string });
  }
  return parts;
};

const fullText = (parts: Array<{ type: string; text?: string }>) =>
  parts
    .filter((part) => part.type === 'text-delta')
    .map((part) => part.text ?? '')
    .join('');

const expectCondition = (condition: boolean, message: string): string => {
  if (!condition) {
    throw new Error(message);
  }
  return message;
};

const checks: Array<{ name: string; run: HarnessCheck }> = [
  {
    name: 'headings scenario streams full markdown (model id selection)',
    run: async () => {
      const provider = createMockProvider();
      const model = provider.languageModel('headings');
      const result = streamText({ model, prompt: 'anything' });
      const parts = await collectFullStream(result);
      const text = fullText(parts);
      expectCondition(text.includes('# Heading Level 1'), 'missing h1');
      expectCondition(text.includes('## Heading Level 2'), 'missing h2');
      expectCondition(text.includes('###### Heading Level 6'), 'missing h6');
      expectCondition(
        parts.some((part) => part.type === 'text-start'),
        'missing text-start',
      );
      expectCondition(
        parts.some((part) => part.type === 'text-end'),
        'missing text-end',
      );
      expectCondition(
        parts.some((part) => part.type === 'finish'),
        'missing finish',
      );
      return `streamed ${text.length} chars with ${parts.length} stream parts, h1-h6 present`;
    },
  },
  {
    name: 'keyword matching selects scenario from user message',
    run: async () => {
      const provider = createMockProvider();
      const model = provider.languageModel('some-unknown-model-id');
      const result = generateText({ model, prompt: 'please respond with tables showing cloud pricing' });
      const { text } = await result;
      expectCondition(text.includes('| Provider | Compute | Storage | Free Tier |'), 'missing table header');
      expectCondition(text.includes('|-'), 'missing alignment row');
      expectCondition(model.calls[0]?.scenarioId === 'tables', `scenarioId was ${model.calls[0]?.scenarioId}`);
      return `scenario resolved to '${model.calls[0]?.scenarioId}' from prompt keywords`;
    },
  },
  {
    name: 'math scenario emits LaTeX formulas',
    run: async () => {
      const provider = createMockProvider();
      const result = generateText({ model: provider.languageModel('math'), prompt: 'show me formulas' });
      const { text } = await result;
      expectCondition(text.includes('$x = \\frac{-b'), 'missing inline latex');
      expectCondition(text.includes('$$e^{i\\pi} + 1 = 0$$'), 'missing display latex');
      return `quadratic formula and Euler's identity present (${text.length} chars)`;
    },
  },
  {
    name: 'code scenario emits fenced code blocks in multiple languages',
    run: async () => {
      const provider = createMockProvider();
      const result = generateText({ model: provider.chat('code'), prompt: 'write a function' });
      const { text } = await result;
      expectCondition(text.includes('```typescript'), 'missing typescript block');
      expectCondition(text.includes('```python'), 'missing python block');
      return `typescript + python fenced blocks present (${text.length} chars)`;
    },
  },
  {
    name: 'speed directive in user message controls streaming rate (20 tokens/s)',
    run: async () => {
      const provider = createMockProvider({ chunkSize: 10 });
      const model = provider.languageModel('long-text');
      const startedAt = Date.now();
      const result = streamText({ model, prompt: 'write something long at 20 tokens per second' });
      const text = await result.text;
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      expectCondition(model.calls[0]?.tokensPerSecond === 20, `parsed speed was ${model.calls[0]?.tokensPerSecond}`);
      const expectedSeconds = Math.ceil(text.length / 10) / 20;
      expectCondition(
        elapsedSeconds >= expectedSeconds * (1 - SPEED_TOLERANCE),
        `streamed too fast: ${elapsedSeconds.toFixed(2)}s, expected >= ${(expectedSeconds * (1 - SPEED_TOLERANCE)).toFixed(2)}s`,
      );
      expectCondition(
        elapsedSeconds <= expectedSeconds * (1 + SPEED_TOLERANCE),
        `streamed too slow: ${elapsedSeconds.toFixed(2)}s, expected <= ${(expectedSeconds * (1 + SPEED_TOLERANCE)).toFixed(2)}s`,
      );
      return `parsed 20 t/s from prompt, streamed ~${Math.ceil(text.length / 10)} tokens in ${elapsedSeconds.toFixed(2)}s (~${expectedSeconds.toFixed(1)}s expected)`;
    },
  },
  {
    name: 'provider default speed applies when prompt has no directive',
    run: async () => {
      const provider = createMockProvider({ tokensPerSecond: 100 });
      const model = provider.languageModel('long-text');
      const startedAt = Date.now();
      const result = streamText({ model, prompt: 'write something long please' });
      await result.text;
      const elapsedMs = Date.now() - startedAt;
      expectCondition(model.calls[0]?.tokensPerSecond === 100, 'default speed not applied');
      expectCondition(elapsedMs > 1000, `finished in ${elapsedMs}ms, expected throttling at 100 t/s`);
      return `default 100 t/s applied, streamed in ${elapsedMs}ms`;
    },
  },
  {
    name: 'speed directive overrides provider default',
    run: async () => {
      const provider = createMockProvider({ tokensPerSecond: 5 });
      const model = provider.languageModel('default');
      const startedAt = Date.now();
      const result = streamText({ model, prompt: 'hello, go fast: 200 tokens per second' });
      await result.text;
      const elapsedMs = Date.now() - startedAt;
      expectCondition(model.calls[0]?.tokensPerSecond === 200, `speed was ${model.calls[0]?.tokensPerSecond}`);
      expectCondition(elapsedMs < 5000, `took ${elapsedMs}ms, directive did not override slow default`);
      return `prompt directive (200 t/s) overrode default 5 t/s, finished in ${elapsedMs}ms (would be ~90s at 5 t/s)`;
    },
  },
  {
    name: 'all speed directive notations parse (t/s, tokens per second, tps, tok/s)',
    run: async () => {
      const notations: Array<[string, number]> = [
        ['at 30 t/s', 30],
        ['at 25 tokens per second', 25],
        ['at 45 tps', 45],
        ['at 12 tok/s', 12],
      ];
      const parsed: string[] = [];
      for (const [prompt, expected] of notations) {
        const provider = createMockProvider({ tokensPerSecond: MAX_TOKENS_PER_SECOND });
        const model = provider.languageModel('default');
        await generateText({ model, prompt: `hi ${prompt}` });
        const actual = model.calls[0]?.tokensPerSecond;
        expectCondition(actual === expected, `'${prompt}': parsed ${actual}, expected ${expected}`);
        parsed.push(`'${prompt}'→${actual}`);
      }
      return parsed.join(', ');
    },
  },
  {
    name: 'first token delay is honored',
    run: async () => {
      const provider = createMockProvider({ firstTokenDelayMs: 300 });
      const model = provider.languageModel('headings');
      const result = streamText({ model, prompt: 'go' });
      const startedAt = Date.now();
      for await (const _part of result.textStream) {
        void _part;
        break;
      }
      const firstTokenMs = Date.now() - startedAt;
      expectCondition(firstTokenMs >= 250, `first token after ${firstTokenMs}ms, expected >= ~300ms`);
      return `first token arrived after ${firstTokenMs}ms`;
    },
  },
  {
    name: 'tool-calls scenario drives real tool execution (multi-step agent)',
    run: async () => {
      const provider = createMockProvider({
        responses: [
          { parts: [{ type: 'tool-call', toolName: 'get_weather', input: { city: 'San Francisco', unit: 'celsius' } }] },
          { text: 'The weather in San Francisco is 18°C and foggy.' },
        ],
      });
      const model = provider.languageModel('weather-model');
      const executedInputs: unknown[] = [];
      const result = await generateText({
        model,
        prompt: 'what is the weather in San Francisco?',
        tools: {
          get_weather: tool({
            description: 'Get the weather for a city',
            inputSchema: jsonSchema<{ city: string; unit?: string }>({
              type: 'object',
              properties: { city: { type: 'string' }, unit: { type: 'string' } },
              required: ['city'],
            }),
            execute: async (input) => {
              executedInputs.push(input);
              return { temperature: 18, condition: 'foggy' };
            },
          }),
        },
        stopWhen: stepCountIs(5),
      });
      expectCondition(executedInputs.length === 1, `tool executed ${executedInputs.length} times`);
      expectCondition((executedInputs[0] as { city: string }).city === 'San Francisco', 'wrong tool input');
      expectCondition(result.text.toLowerCase().includes('18'), 'final answer missing tool result');
      expectCondition(result.finishReason === 'stop', `finishReason was ${result.finishReason}`);
      return `tool executed with ${JSON.stringify(executedInputs[0])}, final answer: "${result.text.slice(0, 60)}..."`;
    },
  },
  {
    name: 'declared tools get schema-generated inputs (canned scenario remaps)',
    run: async () => {
      const provider = createMockProvider({ seed: 7 });
      const model = provider.languageModel('weather-model');
      const executedInputs: Array<{ city: string; unit: string; days: number }> = [];
      const result = await generateText({
        model,
        prompt: 'what is the weather? use the tool',
        tools: {
          get_weather: tool({
            description: 'Get the weather for a city',
            inputSchema: jsonSchema<{ city: string; unit: string; days: number }>({
              type: 'object',
              properties: {
                city: { type: 'string', minLength: 3 },
                unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
                days: { type: 'integer', minimum: 1, maximum: 7 },
              },
              required: ['city', 'unit', 'days'],
            }),
            execute: async (input) => {
              executedInputs.push(input);
              return { temperature: 21, condition: 'sunny' };
            },
          }),
        },
        stopWhen: stepCountIs(5),
      });
      expectCondition(executedInputs.length === 1, `tool executed ${executedInputs.length} times`);
      const input = executedInputs[0];
      expectCondition(typeof input.city === 'string' && input.city.length >= 3, `bad city: ${JSON.stringify(input.city)}`);
      expectCondition(input.unit === 'celsius' || input.unit === 'fahrenheit', `bad unit: ${JSON.stringify(input.unit)}`);
      expectCondition(Number.isInteger(input.days) && input.days >= 1 && input.days <= 7, `bad days: ${JSON.stringify(input.days)}`);
      expectCondition(result.text.length > 0, 'no final answer after tool execution');
      return `generated input ${JSON.stringify(input)} respects enum/bounds, executed OK`;
    },
  },
  {
    name: 'toolChoice forces a specific tool regardless of the prompt',
    run: async () => {
      const provider = createMockProvider();
      const model = provider.languageModel('weather-model');
      const result = await generateText({
        model,
        prompt: 'just say hi',
        toolChoice: { type: 'tool', toolName: 'convert_currency' },
        tools: {
          convert_currency: tool({
            description: 'Convert currency',
            inputSchema: jsonSchema<{ amount: number; from: string; to: string }>({
              type: 'object',
              properties: {
                amount: { type: 'number', minimum: 1, maximum: 1000 },
                from: { type: 'string', enum: ['USD', 'EUR'] },
                to: { type: 'string', enum: ['USD', 'EUR'] },
              },
              required: ['amount', 'from', 'to'],
            }),
          }),
          get_weather: tool({
            description: 'Get the weather for a city',
            inputSchema: jsonSchema<{ city: string }>({ type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }),
          }),
        },
      });
      const content = result.steps[0]?.content ?? [];
      const toolCalls = content.filter((part) => part.type === 'tool-call') as Array<{ toolName: string; input: Record<string, unknown> }>;
      expectCondition(toolCalls.length === 1, `expected 1 tool call, got ${toolCalls.length}`);
      expectCondition(toolCalls[0].toolName === 'convert_currency', `wrong tool: ${toolCalls[0].toolName}`);
      const input = toolCalls[0].input as { amount: number; from: string; to: string };
      expectCondition(input.amount >= 1 && input.amount <= 1000, `bad amount: ${JSON.stringify(input)}`);
      expectCondition(input.from === 'USD' || input.from === 'EUR', `bad from: ${JSON.stringify(input)}`);
      expectCondition(input.to === 'USD' || input.to === 'EUR', `bad to: ${JSON.stringify(input)}`);
      return `forced tool call to convert_currency with generated input ${JSON.stringify(input)}`;
    },
  },
  {
    name: 'toolChoice none suppresses tool calls, required adds them',
    run: async () => {
      const provider = createMockProvider();
      const noneModel = provider.languageModel('weather-model');
      await generateText({
        model: noneModel,
        prompt: 'what is the weather?',
        toolChoice: 'none',
        tools: { get_weather: tool({ description: 'weather', inputSchema: jsonSchema({ type: 'object', properties: {} }) }) },
      });
      expectCondition(noneModel.calls[0].scenarioId === 'tool-calls', `scenario was ${noneModel.calls[0].scenarioId}`);

      const requiredModel = provider.languageModel('generic-model');
      const requiredExecuted: unknown[] = [];
      await generateText({
        model: requiredModel,
        prompt: 'just say hi',
        toolChoice: 'required',
        tools: {
          get_weather: tool({
            description: 'weather',
            inputSchema: jsonSchema<{ city: string }>({ type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }),
            execute: async (input) => {
              requiredExecuted.push(input);
              return { temperature: 20 };
            },
          }),
        },
      });
      expectCondition(requiredExecuted.length === 1, `required tool not executed: ${requiredExecuted.length}`);
      return `none: no tool call; required: tool executed with ${JSON.stringify(requiredExecuted[0])}`;
    },
  },
  {
    name: 'toolInputs preset overrides schema generation',
    run: async () => {
      const provider = createMockProvider({ toolInputs: { get_weather: { city: 'Oslo', unit: 'celsius', days: 3 } } });
      const executedInputs: Array<{ city: string; unit: string; days: number }> = [];
      await generateText({
        model: provider.languageModel('weather-model'),
        prompt: 'what is the weather? use the tool',
        tools: {
          get_weather: tool({
            description: 'Get the weather for a city',
            inputSchema: jsonSchema<{ city: string; unit: string; days: number }>({
              type: 'object',
              properties: { city: { type: 'string' }, unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }, days: { type: 'integer' } },
              required: ['city', 'unit', 'days'],
            }),
            execute: async (input) => {
              executedInputs.push(input);
              return { temperature: 4, condition: 'snow' };
            },
          }),
        },
        stopWhen: stepCountIs(5),
      });
      expectCondition(executedInputs.length === 1, `tool executed ${executedInputs.length} times`);
      expectCondition(
        executedInputs[0].city === 'Oslo' && executedInputs[0].unit === 'celsius' && executedInputs[0].days === 3,
        `preset not applied: ${JSON.stringify(executedInputs[0])}`,
      );
      return `preset input ${JSON.stringify(executedInputs[0])} used verbatim`;
    },
  },
  {
    name: 'provider-executed tool results stream tool-result parts',
    run: async () => {
      const provider = createMockProvider();
      const model = provider.languageModel('search-model');
      const result = streamText({ model, prompt: 'do a web search for me' });
      const parts = await collectFullStream(result);
      const toolResults = parts.filter((part) => part.type === 'tool-result');
      const toolCalls = parts.filter((part) => part.type === 'tool-call');
      expectCondition(toolCalls.length === 1, `expected 1 tool-call part, got ${toolCalls.length}`);
      expectCondition(toolResults.length === 1, `expected 1 tool-result part, got ${toolResults.length}`);
      const toolResult = toolResults[0] as { toolCallId?: string; output?: { sources?: string[] }; providerExecuted?: boolean };
      expectCondition(typeof toolResult.toolCallId === 'string', 'tool-result missing toolCallId');
      expectCondition(toolResult.providerExecuted === true, `providerExecuted flag missing: ${JSON.stringify(toolResult)}`);
      expectCondition(toolResult.output?.sources?.length === 1, `bad output payload: ${JSON.stringify(toolResult.output)}`);
      expectCondition(fullText(parts).toLowerCase().includes('searching the web'), 'follow-up text missing');
      return 'streamed tool-call + paired tool-result (sources: 1) + final text';
    },
  },
  {
    name: 'reasoning scenario streams thinking before the answer',
    run: async () => {
      const provider = createMockProvider();
      const model = provider.languageModel('reasoning');
      const result = streamText({ model, prompt: 'why is the sky blue? think step by step' });
      const parts = await collectFullStream(result);
      const reasoningText = parts
        .filter((part) => part.type === 'reasoning-delta')
        .map((part) => (part as { text: string }).text)
        .join('');
      const text = fullText(parts);
      expectCondition(reasoningText.includes('Rayleigh scattering'), 'missing reasoning content');
      expectCondition(text.includes('The answer is 42'), 'missing final answer');
      const reasoningEndIndex = parts.findIndex((part) => part.type === 'reasoning-end');
      const textStartIndex = parts.findIndex((part) => part.type === 'text-start');
      expectCondition(reasoningEndIndex >= 0 && textStartIndex > reasoningEndIndex, 'reasoning must precede text');
      expectCondition(reasoningText.length > 0, 'no reasoning deltas');
      return `${reasoningText.length} reasoning chars streamed before ${text.length} text chars`;
    },
  },
  {
    name: 'json scenario works with generateObject and jsonSchema',
    run: async () => {
      const provider = createMockProvider();
      const model = provider.languageModel('json');
      const result = await generateObject({
        model,
        schema: jsonSchema<{ name: string; email: string; active: boolean }>({
          type: 'object',
          properties: { name: { type: 'string' }, email: { type: 'string' }, active: { type: 'boolean' } },
          required: ['name', 'email', 'active'],
        }),
        prompt: 'give me a structured object',
      });
      expectCondition(result.object.name === 'Ada Lovelace', `name was ${result.object.name}`);
      expectCondition(result.object.email === 'ada@example.com', 'email mismatch');
      expectCondition(result.object.active === true, 'active mismatch');
      return `parsed object: ${JSON.stringify(result.object)}`;
    },
  },
  {
    name: 'image-part scenario emits a file part through streamText',
    run: async () => {
      const provider = createMockProvider();
      const model = provider.languageModel('image-part');
      const result = streamText({ model, prompt: 'draw me a picture' });
      const parts = await collectFullStream(result);
      const filePart = parts.find((part) => part.type === 'file') as { file: { mediaType: string; uint8Array: Uint8Array } } | undefined;
      if (!filePart) {
        throw new Error('no file part in stream');
      }
      expectCondition(filePart.file.mediaType === 'image/png', `media type was ${filePart.file.mediaType}`);
      expectCondition(filePart.file.uint8Array.length === 70, `png bytes: ${filePart.file.uint8Array.length}`);
      const text = fullText(parts);
      expectCondition(text.includes('image you asked for'), 'missing surrounding text');
      return `file part: ${filePart.file.mediaType}, ${filePart.file.uint8Array.length} bytes decoded`;
    },
  },
  {
    name: 'file-part scenario emits a text file part through generateText',
    run: async () => {
      const provider = createMockProvider();
      const model = provider.languageModel('file-part');
      const result = await generateText({ model, prompt: 'generate a document file' });
      const filePart = result.files.at(0);
      if (!filePart) {
        throw new Error('no file in result');
      }
      expectCondition(filePart.mediaType === 'text/plain', `media type was ${filePart.mediaType}`);
      const decoded = new TextDecoder().decode(filePart.uint8Array);
      expectCondition(decoded.includes('Hello from the mock provider!'), `decoded: ${decoded}`);
      return `file part decoded: "${decoded}"`;
    },
  },
  {
    name: 'error scenario produces a mid-stream error',
    run: async () => {
      const provider = createMockProvider();
      const model = provider.languageModel('error');
      const onErrorEvents: unknown[] = [];
      const result = streamText({ model, prompt: 'explode', onError: (event) => onErrorEvents.push(event.error) });
      const parts = await collectFullStream(result);
      const streamedText = fullText(parts);
      const errorPart = parts.find((part) => part.type === 'error') as { error?: { message?: string } } | undefined;
      expectCondition(streamedText.length > 0, 'no text streamed before the error');
      expectCondition(errorPart !== undefined, 'no error part in fullStream');
      expectCondition(onErrorEvents.length === 1, `onError fired ${onErrorEvents.length} times`);
      return `${streamedText.length} chars streamed, then error part: ${errorPart?.error?.message ?? String(onErrorEvents[0]).slice(0, 60)}`;
    },
  },
  {
    name: 'max-tokens scenario reports length finish reason',
    run: async () => {
      const provider = createMockProvider();
      const model = provider.languageModel('max-tokens');
      const result = await generateText({ model, prompt: 'truncate at the token limit' });
      expectCondition(result.finishReason === 'length', `finishReason was ${result.finishReason}`);
      return `finishReason: ${result.finishReason}`;
    },
  },
  {
    name: 'multi-call response queue returns sequential scripted responses',
    run: async () => {
      const provider = createMockProvider({
        responses: ['headings', { text: 'Second scripted answer.' }, 'tables'],
      });
      const model = provider.languageModel('anything');
      const first = await generateText({ model, prompt: 'call one' });
      const second = await generateText({ model, prompt: 'call two' });
      const third = await generateText({ model, prompt: 'call three' });
      expectCondition(first.text.includes('# Heading Level 1'), 'first call not headings');
      expectCondition(second.text === 'Second scripted answer.', `second call: ${second.text}`);
      expectCondition(third.text.includes('| Provider |'), 'third call not tables');
      expectCondition(model.calls.length === 3, `calls recorded: ${model.calls.length}`);
      return `3 sequential responses: headings → inline text → tables; calls tracked: ${model.calls.length}`;
    },
  },
  {
    name: 'custom scenario registration and override',
    run: async () => {
      const provider = createMockProvider({
        scenarios: {
          error: { parts: [{ type: 'text', text: 'friendly failure' }], finishReason: 'stop' },
          haiku: {
            keywords: ['haiku', 'poem'],
            parts: [{ type: 'text', text: 'An old silent pond\nA frog jumps into water\nSplash! Silence again.' }],
          },
        },
      });
      const overrideModel = provider.languageModel('error');
      const overrideResult = await generateText({ model: overrideModel, prompt: 'fail please' });
      expectCondition(overrideResult.text === 'friendly failure', `override: ${overrideResult.text}`);
      const haikuModel = provider.languageModel('haiku');
      const haikuResult = await generateText({ model: haikuModel, prompt: 'write me a haiku' });
      expectCondition(haikuResult.text.includes('Splash!'), 'haiku missing');
      const keywordModel = provider.languageModel('generic');
      const keywordResult = await generateText({ model: keywordModel, prompt: 'write a poem for me' });
      expectCondition(keywordResult.text.includes('frog jumps'), `keyword scenario not matched: ${keywordResult.text}`);
      return "built-in 'error' overridden, custom 'haiku' matched by id and by keyword";
    },
  },
  {
    name: 'usage reporting counts input and output tokens',
    run: async () => {
      const provider = createMockProvider({ chunkSize: 4 });
      const model = provider.languageModel('headings');
      const result = await generateText({ model, prompt: 'give me headings' });
      const usage = result.usage;
      expectCondition((usage.inputTokens ?? 0) > 0, `input tokens: ${usage.inputTokens}`);
      expectCondition((usage.outputTokens ?? 0) > 0, `output tokens: ${usage.outputTokens}`);
      return `input: ${usage.inputTokens} tokens, output: ${usage.outputTokens} tokens`;
    },
  },
  {
    name: 'abort signal cancels streaming promptly',
    run: async () => {
      const provider = createMockProvider({ tokensPerSecond: 10 });
      const model = provider.languageModel('long-text');
      const abortController = new AbortController();
      const result = streamText({ model, prompt: 'long stream please', abortSignal: abortController.signal });
      const deltas: string[] = [];
      const startedAt = Date.now();
      try {
        for await (const delta of result.textStream) {
          deltas.push(delta);
          if (deltas.length === 10) {
            abortController.abort();
          }
        }
      } catch {
        void 0;
      }
      const elapsedMs = Date.now() - startedAt;
      expectCondition(deltas.length < 150, `did not abort early: ${deltas.length} deltas`);
      expectCondition(elapsedMs < 5000, `abort took too long: ${elapsedMs}ms`);
      return `streaming aborted after ${deltas.length} deltas in ${elapsedMs}ms (full stream would take ~15s)`;
    },
  },
  {
    name: 'model exposes mock provider metadata for assertions',
    run: async () => {
      const provider = createMockProvider();
      const model: MockLanguageModel = provider.languageModel('tables');
      await generateText({ model, prompt: 'compare providers' });
      expectCondition(model.provider === 'ai-mock-provider', `provider: ${model.provider}`);
      expectCondition(model.specificationVersion === 'v4', 'not a v4 model');
      expectCondition(model.calls[0].scenarioId === 'tables', 'call info missing scenario');
      expectCondition(model.calls[0].prompt === 'compare providers', 'call info missing prompt');
      return `provider='${model.provider}', spec='${model.specificationVersion}', call info tracked`;
    },
  },
  {
    name: 'lorem scenario generates random filler text (keyword selection)',
    run: async () => {
      const provider = createMockProvider();
      const model = provider.languageModel('general');
      const result = await generateText({ model, prompt: 'give me some lorem ipsum please' });
      const paragraphs = result.text.split('\n\n').filter(Boolean);
      expectCondition(paragraphs.length === 3, `expected 3 paragraphs, got ${paragraphs.length}`);
      expectCondition(result.text.length > 200, `text too short: ${result.text.length} chars`);
      expectCondition(model.calls[0].scenarioId === 'lorem', `wrong scenario: ${model.calls[0].scenarioId}`);
      return `${paragraphs.length} paragraphs, ${result.text.split(/\s+/).length} words, ${result.text.length} chars`;
    },
  },
  {
    name: 'seeded provider is fully deterministic',
    run: async () => {
      const first = await generateText({ model: createMockProvider({ seed: 42 }).languageModel('lorem'), prompt: 'lorem ipsum' });
      const second = await generateText({ model: createMockProvider({ seed: 42 }).languageModel('lorem'), prompt: 'lorem ipsum' });
      const third = await generateText({ model: createMockProvider({ seed: 7 }).languageModel('lorem'), prompt: 'lorem ipsum' });
      expectCondition(first.text === second.text, 'same seed produced different text');
      expectCondition(first.text !== third.text, 'different seed produced identical text');
      return `seed 42 reproducible (${first.text.length} chars), seed 7 differs (${third.text.length} chars)`;
    },
  },
  {
    name: 'unseeded providers differ across instances',
    run: async () => {
      const first = await generateText({ model: createMockProvider().languageModel('lorem'), prompt: 'lorem ipsum' });
      const second = await generateText({ model: createMockProvider().languageModel('lorem'), prompt: 'lorem ipsum' });
      expectCondition(first.text !== second.text, 'unseeded providers produced identical text');
      return `first ${first.text.length} chars, second ${second.text.length} chars, all different`;
    },
  },
  {
    name: 'prompt directive controls lorem amount and unit',
    run: async () => {
      const provider = createMockProvider();
      const words = await generateText({ model: provider.languageModel('lorem'), prompt: 'write 30 words of lorem ipsum' });
      const sentences = await generateText({ model: provider.languageModel('lorem'), prompt: 'give me 4 sentences of filler' });
      const wordCount = words.text.split(/\s+/).filter(Boolean).length;
      const sentenceCount = sentences.text.split(/[.!?]+/).filter(Boolean).length;
      expectCondition(wordCount === 30, `expected 30 words, got ${wordCount}`);
      expectCondition(sentenceCount === 4, `expected 4 sentences, got ${sentenceCount}`);
      return `directive: 30 words -> ${wordCount}, 4 sentences -> ${sentenceCount}`;
    },
  },
  {
    name: 'custom scenario can mix canned text with lorem parts',
    run: async () => {
      const provider = createMockProvider({
        seed: 123,
        scenarios: {
          story: {
            parts: [
              { type: 'text', text: 'Once upon a time:' },
              { type: 'lorem', unit: 'sentences', count: 3 },
            ],
          },
        },
      });
      const result = await generateText({ model: provider.languageModel('story'), prompt: 'tell me a story' });
      expectCondition(result.text.startsWith('Once upon a time:'), 'canned intro missing');
      const sentenceCount = result.text
        .slice('Once upon a time:'.length)
        .split(/[.!?]+/)
        .filter(Boolean).length;
      expectCondition(sentenceCount === 3, `expected 3 generated sentences, got ${sentenceCount}`);
      return `intro + ${sentenceCount} random sentences (${result.text.length} chars), reproducible via seed 123`;
    },
  },
];

export const runHarness = async (): Promise<HarnessResult[]> => {
  const results: HarnessResult[] = [];
  for (const check of checks) {
    const startedAt = Date.now();
    try {
      const details = await check.run();
      results.push({ name: check.name, passed: true, details, durationMs: Date.now() - startedAt });
    } catch (error) {
      results.push({
        name: check.name,
        passed: false,
        details: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
    }
  }
  return results;
};
