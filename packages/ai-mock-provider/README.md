# ai-mock-provider

A **mock provider for the [Vercel AI SDK](https://ai-sdk.dev)** — a fake LLM for testing streaming, tool calling and agents. No API keys, no network, no GPU.

Implements the [Vercel AI SDK](https://ai-sdk.dev) `LanguageModelV4` provider specification, so it drops straight into `generateText`, `streamText`, `generateObject`, `embed` and multi-step agents. It answers with **canned, scenario-based responses** (markdown headings, tables, LaTeX math, code blocks, JSON, images, files, tool calls, reasoning…), streams them at a **configurable tokens-per-second rate** — controllable straight from the user message — and supports sequential multi-call scripts, error simulation and abort handling.

## Why

Testing UIs and agents that consume LLM streams needs a model that behaves like a real one:

- streams token by token, at a realistic (and controllable) speed
- responds differently depending on what the user asks for
- can produce reasoning tokens, tool calls, files, structured output
- can fail mid-stream, get truncated, or be aborted

`ai-mock-provider` does all of this deterministically. Related tools: the built-in `MockLanguageModelV4` from `ai/test` gives you raw stream parts but no scenarios or speed control; [`@copilotkit/aimock`](https://github.com/CopilotKit/aimock) mocks providers over HTTP instead of in-process; [`llmao`](https://github.com/icernigoj/llmao) scripts responses but has no scenario library and no prompt-driven speed control.

## Install

```sh
npm install ai-mock-provider
```

Peer dependency: `@ai-sdk/provider` v4 (already available if you use AI SDK v7 or any v4 provider).

## Quick start

```ts
import { createMockProvider } from 'ai-mock-provider';
import { streamText } from 'ai';

const provider = createMockProvider();

const result = streamText({
  model: provider.languageModel('tables'),
  prompt: 'compare cloud providers',
});

for await (const delta of result.textStream) {
  process.stdout.write(delta);
}
```

You can select a scenario two ways:

1. **Model id** — `provider.languageModel('math')` forces the `math` scenario for every call.
2. **Keywords in the user message** — with any model id, the last user message is matched against scenario keywords: *"please respond with tables"* selects the `tables` scenario.

If nothing matches, the `default` scenario answers with an overview of everything the provider can do.

## Controlling streaming speed from the user message

Include a speed directive anywhere in the prompt. The directive is parsed, applied to the current call, and stripped from the text before scenario matching.

```
at 30 t/s
at 20 tokens per second
at 45 tps
at 12 tok/s
instantly
```

```ts
const result = streamText({
  model: provider.languageModel('long-text'),
  prompt: 'write a long story at 20 tokens per second',
});
// streams for ~length/4/20 seconds
```

Precedence: **prompt directive > scenario/response override > provider default**.

## Built-in scenarios

| Scenario id | Triggered by keywords | Produces |
|---|---|---|
| `headings` | heading, headings, title, section | Markdown headings H1–H6, bold/italic/inline code |
| `tables` | table, tables, tabular, comparison, columns | Two markdown tables (default + aligned) |
| `code` | code, snippet, function, typescript, javascript, python… | Fenced code blocks in TypeScript and Python |
| `math` | math, formula, equations, latex, katex, integral | Inline `$…$` and display `$$…$$` LaTeX |
| `lists` | list, bullet, steps, checklist | Ordered, unordered and nested lists |
| `links` | link, hyperlink, citation, url | Markdown links and bare URLs |
| `blockquotes` | quote, blockquote, quotation | Simple and nested blockquotes |
| `long-text` | long, essay, article, detailed, story | Multi-paragraph prose |
| `reasoning` | think, reasoning, reason, why, step by step | Reasoning deltas followed by the answer |
| `tool-calls` | tool, weather, lookup | A `get_weather` tool call (input generated from your declared tools) |
| `provider-tools` | web search, provider tool, provider-executed, built-in tool | Tool call + provider-executed tool-result in one response |
| `json` | json, structured, schema | Pretty-printed JSON (also used for `responseFormat: json`) |
| `image-part` | image, picture, photo, png | A 1×1 PNG file part surrounded by text |
| `file-part` | file, attachment, document, pdf | A `text/plain` file part surrounded by text |
| `lorem` | lorem, filler, dummy text, placeholder text, random text | Random lorem-ipsum filler text (see below) |
| `error` | error, fail, crash, explode | Text, then a mid-stream error |
| `max-tokens` | max tokens, token limit, truncate, cut off | Truncated text with `length` finish reason |
| `default` | (fallback) | Overview of all scenarios |

### Random text (lorem ipsum)

The `lorem` scenario streams freshly generated lorem-ipsum filler (powered by the zero-dependency [`lorem-ipsum`](https://www.npmjs.com/package/lorem-ipsum) package) — ideal for testing long-stream rendering, truncation and performance without canned content.

The amount is controllable **from the user message**:

```ts
await generateText({ model: provider.languageModel('lorem'), prompt: 'write 30 words of lorem ipsum' });
await generateText({ model: provider.languageModel('lorem'), prompt: 'give me 4 sentences of filler' });
await generateText({ model: provider.languageModel('lorem'), prompt: 'generate 3 paragraphs of lorem' });
```

Randomness is reproducible: pass a `seed` and every provider instance generates the identical sequence of texts — perfect for snapshot tests. Without a seed, each instance is different.

```ts
const deterministic = createMockProvider({ seed: 42 });
const chaotic = createMockProvider();
```

## Configuration

```ts
const provider = createMockProvider({
  // Streaming speed fallback (tokens/second). 0 = instant (default).
  tokensPerSecond: 100,

  // Delay before the first streamed content part, in ms (default 0).
  firstTokenDelayMs: 250,

  // Characters per simulated token (default 4).
  chunkSize: 4,

  // Scenario used when neither the model id nor keywords match.
  defaultScenario: 'default',

  // Add or override scenarios (see below).
  scenarios: { /* ... */ },

  // Sequential per-call scripts (see "Multi-call responses").
  responses: ['headings', 'tables'],

  // Seed for the internal PRNG: identical seeds produce identical
  // random text sequences (deterministic tests). Omit for true randomness.
  seed: 42,

  // Defaults for lorem parts (see "Random text" above).
  lorem: {
    unit: 'paragraphs',        // 'words' | 'sentences' | 'paragraphs'
    count: 3,
    sentencesPerParagraph: { min: 3, max: 7 },
    wordsPerSentence: { min: 6, max: 14 },
  },

  // Preset tool inputs by name (see "Tool calls" below) — beat schema generation.
  toolInputs: { get_weather: { city: 'Oslo', unit: 'celsius', days: 3 } },
});
```

## Configuration

```ts
const provider = createMockProvider({
  // Streaming speed fallback (tokens/second). 0 = instant (default).
  tokensPerSecond: 100,

  // Delay before the first streamed content part, in ms (default 0).
  firstTokenDelayMs: 250,

  // Characters per simulated token (default 4).
  chunkSize: 4,

  // Scenario used when neither the model id nor keywords match.
  defaultScenario: 'default',

  // Add or override scenarios (see below).
  scenarios: { /* ... */ },

  // Sequential per-call scripts (see "Multi-call responses").
  responses: ['headings', 'tables'],
});
```

Models are created like with any other provider:

```ts
provider(modelId);
provider.languageModel(modelId);
provider.chat(modelId);
```

Each model instance records its calls for assertions:

```ts
model.calls;
// [{ modelId, scenarioId, prompt, tokensPerSecond, firstTokenDelayMs, timestamp }]
```

## Multi-call responses

Script different responses per call — useful for multi-step agents ("call 1 plans, call 2 answers"). Queue items are consumed in order; after exhaustion, normal scenario resolution resumes.

```ts
const provider = createMockProvider({
  responses: [
    'headings',                                   // a scenario id
    { text: 'Second scripted answer.' },          // inline text shorthand
    { parts: [{ type: 'tool-call', toolName: 'get_weather', input: { city: 'Oslo' } }] },
    { text: 'Now it is 12°C.', tokensPerSecond: 50 },
  ],
});

const model = provider.languageModel('agent-model');
await generateText({ model, prompt: 'step 1' }); // headings
await generateText({ model, prompt: 'step 2' }); // 'Second scripted answer.'
```

A queue item may set `tokensPerSecond` / `firstTokenDelayMs` for that call (a prompt directive still wins).

## Tool calls

The provider emits provider-spec tool call stream parts, so real tool execution works:

```ts
import { generateText, tool, stepCountIs, jsonSchema } from 'ai';

const provider = createMockProvider({
  responses: [
    { parts: [{ type: 'tool-call', toolName: 'get_weather', input: { city: 'San Francisco' } }] },
    { text: 'It is 18°C and foggy.' },
  ],
});

const result = await generateText({
  model: provider.languageModel('weather-model'),
  prompt: 'what is the weather in San Francisco?',
  tools: {
    get_weather: tool({
      description: 'Get the weather for a city',
      inputSchema: jsonSchema({ type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }),
      execute: async (input) => ({ temperature: 18, condition: 'foggy' }),
    }),
  },
  stopWhen: stepCountIs(5),
});
```

### Inputs from your declared tools

You don't have to script inputs. When the client passes `tools`, the provider generates schema-plausible inputs for the tool it calls — respecting `enum`, `minimum`/`maximum`, `minLength`/`maxLength`, formats (`email`, `uri`, `date-time`, `uuid`…), `default`/`examples`/`const`, and common property-name hints (`city` → `"San Francisco"`, `name` → `"Ada Lovelace"`…). If a canned scenario names a tool that isn't declared, it is remapped to your first declared tool and its input is generated from your schema.

```ts
const provider = createMockProvider(); // 'tool-calls' scenario matches "what is the weather?"
const result = await generateText({
  model: provider.languageModel('agent'),
  prompt: 'what is the weather? use the tool',
  tools: {
    get_weather: tool({
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          city: { type: 'string', minLength: 3 },
          unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
          days: { type: 'integer', minimum: 1, maximum: 7 },
        },
        required: ['city', 'unit', 'days'],
      }),
      execute: async (input) => {
        // input is schema-valid: { city: 'San Francisco', unit: 'fahrenheit', days: 4 } (seeded → reproducible)
        return { temperature: 21 };
      },
    }),
  },
});
```

Prefer fixed inputs? Preset them per tool — presets win over generation:

```ts
const provider = createMockProvider({ toolInputs: { get_weather: { city: 'Oslo', unit: 'celsius', days: 3 } } });
```

Or author explicit inputs on the tool-call part (kept verbatim when the tool is declared).

### toolChoice support

| `toolChoice` | Behavior |
|---|---|
| `auto` / omitted | Scenario decides (the `tool-calls` scenario calls tools) |
| `none` | Tool-call parts are stripped — text only |
| `required` | Guarantees a tool call (first declared tool, generated input) |
| `{ type: 'tool', toolName }` | Forces a call to that exact tool on every step |

After a tool result is sent back (natural `auto` flow), the provider answers with text instead of calling the tool again — so agent loops terminate cleanly.

### Provider-executed tool results

The v4 spec supports tools executed by the provider itself (like real web search or code interpreter). Author a `tool-result` part after a tool-call part and the provider emits a provider-spec `tool-result` stream part — AI SDK surfaces it in `fullStream` with `providerExecuted: true`:

```ts
const provider = createMockProvider({
  scenarios: {
    research: {
      parts: [
        { type: 'tool-call', toolName: 'web_search', input: { query: 'latest AI SDK release' } },
        { type: 'tool-result', toolName: 'web_search', result: { sources: ['https://ai-sdk.dev'], summary: 'A new release shipped.' } },
        { type: 'text', text: 'Here is what I found.' },
      ],
    },
  },
});
```

The built-in `provider-tools` scenario (keywords: *web search*, *provider tool*, *provider-executed*, *built-in tool*) demos this flow.

## Custom scenarios

Override built-ins or register new ones. Scenarios are selected by exact model id or by keyword match against the last user message.

```ts
const provider = createMockProvider({
  scenarios: {
    // Override the built-in 'error' scenario
    error: { parts: [{ type: 'text', text: 'friendly failure' }], finishReason: 'stop' },

    // New scenario: matched by id 'haiku' or by the keywords
    haiku: {
      keywords: ['haiku', 'poem'],
      parts: [
        { type: 'text', text: 'An old silent pond\nA frog jumps into water\nSplash! Silence again.' },
      ],
    },
  },
});
```

A scenario is a `MockScenarioContent`:

```ts
type MockScenarioContent = {
  text?: string;                    // shorthand for a single text part
  parts?: MockPart[];               // ordered content parts
  finishReason?: 'stop' | 'length' | 'tool-calls' | 'error' | ...;
  keywords?: string[];              // word-boundary matched against the last user message
  tokensPerSecond?: number;         // speed override for this scenario
  firstTokenDelayMs?: number;       // latency override for this scenario
};

type MockPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolName: string; input?: Record<string, unknown> }  // input generated from declared tools when omitted
  | { type: 'tool-result'; toolName: string; result?: Record<string, unknown>; isError?: boolean }  // provider-executed tool result
  | { type: 'file'; mediaType: string; data: string }   // base64
  | { type: 'lorem'; unit: 'words' | 'sentences' | 'paragraphs'; count: number }  // generated at call time
  | { type: 'error'; message: string };
```

The `lorem` part generates random filler at call time using the provider's PRNG (seeded or not), so custom scenarios can mix canned and random content:

```ts
const provider = createMockProvider({
  seed: 123, // reproducible filler
  scenarios: {
    story: {
      parts: [{ type: 'text', text: 'Once upon a time:' }, { type: 'lorem', unit: 'sentences', count: 3 }],
    },
  },
});
```

## Error simulation

The `error` scenario streams a few text chunks, then emits an error part and stops — no finish part is produced at the model level.

- With `streamText`, the AI SDK surfaces the error as an `error` part in `fullStream` and via the `onError` callback (AI SDK v7 semantics: stream errors are delivered in-stream).
- With `generateText`, `doGenerate` throws a retryable-shaped `APICallError` (status 500).

## Structured output

`generateObject` against the `json` scenario (or any scenario producing JSON text):

```ts
const { object } = await generateObject({
  model: provider.languageModel('json'),
  schema: jsonSchema({ type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' } }, required: ['name', 'email'] }),
  prompt: 'give me a structured object',
});
// { name: 'Ada Lovelace', email: 'ada@example.com', ... }
```

When `responseFormat` is `json` and no scenario matches, the `json` scenario is used automatically.

## Aborting

The stream honors the `abortSignal` passed by the AI SDK: emission stops at the next chunk boundary, so cancellation is immediate even at low tokens-per-second.

## Usage reporting

Every call reports usage derived from the simulated tokenization: `usage.inputTokens` estimates prompt tokens, `usage.outputTokens` counts emitted text/reasoning chunks.

## E2E harness

The package ships with an end-to-end harness that exercises the provider through the real AI SDK (`generateText`, `streamText`, `generateObject`, tools, aborts) across 31 checks — scenario content, speed timing, parsing of all directive notations, tool execution with schema-generated inputs and `toolChoice` modes, provider-executed tool results, reasoning order, file parts, errors, multi-call queues, custom scenarios, seeded and unseeded lorem generation, usage and abort.

```sh
npm run harness     # runs the harness and prints a PASS/FAIL table
npm test            # same checks as a vitest suite, plus unit tests
```

## API summary

| Export | Description |
|---|---|
| `createMockProvider(options?)` | Creates the provider (`provider(modelId)`, `.languageModel`, `.chat`) |
| `MockLanguageModelV4` | The model class implementing the v4 spec |
| `DEFAULT_SCENARIOS` | The built-in scenario list |
| `parseSpeedDirective(text)` | Parses speed directives → `{ tokensPerSecond, cleanedText }` |
| `parseLoremDirective(text)` | Parses lorem amount directives → `{ unit?, count? }` |
| `generateLoremText(part, rng, config?)` | Generates lorem text for a `lorem` part |
| `generateToolInput(schema, rng)` | Generates a schema-plausible tool input from a JSON Schema |
| `createRng(seed?)` | Seeded PRNG factory (mulberry32) |
| `tokenize(text, chunkSize)` / `estimateTokenCount(text, chunkSize)` | Token chunking helpers |
| `scenarioFromSpecifier(id, specifier)` | Normalizes a scenario specifier |
| `matchScenarioByKeywords(text, scenarios)` | Keyword-based scenario resolution |

Types: `MockProvider`, `MockProviderOptions`, `MockScenario`, `MockScenarioContent`, `MockPart`, `MockLoremPart`, `MockLoremOptions`, `MockResponseSpecifier`, `MockFinishReason`, `MockCallInfo`, `MockLanguageModel`, `Prng`.

## Development

```sh
npm run typecheck   # tsc --noEmit
npm run build       # dual ESM + CJS bundle + type declarations into dist/
npm test            # unit + e2e tests
npm run harness     # standalone e2e harness
```

## License

MIT
