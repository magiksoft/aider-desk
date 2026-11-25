import type { MockScenario, MockScenarioContent } from './types.js';

const TEXT = (text: string) => ({ type: 'text' as const, text });
const REASONING = (text: string) => ({ type: 'reasoning' as const, text });
const TOOL_CALL = (toolName: string, input?: Record<string, unknown>) => ({ type: 'tool-call' as const, toolName, ...(input !== undefined ? { input } : {}) });
const FILE = (mediaType: string, data: string) => ({ type: 'file' as const, mediaType, data });
const ERROR = (message: string) => ({ type: 'error' as const, message });

const HEADINGS = `# Heading Level 1

Introductory paragraph that explains the purpose of this document.

## Heading Level 2

More detail lives under this second level heading.

### Heading Level 3

This level is often used for subsections of a chapter.

#### Heading Level 4

The deepest commonly used heading level.

##### Heading Level 5

Even deeper, rarely used but valid.

###### Heading Level 6

The final heading level in markdown.

Some closing text with **bold**, *italic*, and \`inline code\`.`;

const TABLES = `Here is a comparison of the major cloud providers:

| Provider | Compute | Storage | Free Tier |
|----------|---------|---------|-----------|
| AWS | EC2 | S3 | Yes (limited) |
| GCP | Compute Engine | Cloud Storage | Yes ($300 credit) |
| Azure | Virtual Machines | Blob Storage | Yes (limited) |
| Hetzner | Cloud Servers | Volumes | No |

And a right-aligned table:

| Language | Year | Paradigm |
|---------:|:-----|:--------|
| Python | 1991 | Multi-paradigm |
| Rust | 2010 | Systems |
| TypeScript | 2012 | Typed |

Both tables stream column by column as the tokens arrive.`;

const CODE = `Sure! Here is an example in TypeScript:

\`\`\`typescript
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const parse = (input: string): Result<number> => {
  const value = Number(input);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false, error: 'not a number' };
};
\`\`\`

And the same idea in Python:

\`\`\`python
import math

def parse(value: str) -> float | None:
    try:
        return float(value)
    except ValueError:
        return None
\`\`\`

Note how the closing fence arrives in its own chunk.`;

const MATH = `Here are some famous formulas:

The quadratic formula: $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$

Euler's identity as a display formula:

$$e^{i\\pi} + 1 = 0$$

The Gaussian integral:

$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$

And inline physics: $E = mc^2$, $F = ma$, and $\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}$.`;

const LISTS = `Here is what you need to do:

1. Clone the repository
2. Install dependencies with your package manager
3. Run the development server

And some unordered notes:

- Keep functions small
- Prefer explicit types at module boundaries
- Write tests before refactoring
  - Nested items work too
    - As deep as you like

That covers the basics.`;

const LINKS = `Some useful resources:

- The [AI SDK documentation](https://ai-sdk.dev/docs) covers every provider
- See also [the provider specification](https://github.com/vercel/ai) for details
- A bare link works too: https://example.com

> Citations and links stream as plain markdown.`;

const BLOCKQUOTES = `> Simplicity is prerequisite for reliability.
>
> — Edsger W. Dijkstra

And a nested quote:

> Outer thought
> > Inner thought
> Back to outer

Regular text resumes after the quotes.`;

const LONG_TEXT = `The morning light arrived slowly, the way it does in early autumn, filtering through half-closed blinds and painting thin gold stripes across the wooden floor of the study. Elena sat at her desk with a cup of tea that had gone cold an hour ago, reading the same paragraph for the fourth time.

Outside, the city was waking up. Delivery vans hummed in the street below, a dog barked twice and stopped, and somewhere a window opened with the particular squeal of hinges that have asked for oil for years. She marked her place with a pencil and looked out at the rooftops, thinking about nothing in particular, which is to say she was thinking about everything at once.

There is a particular kind of quiet that arrives only in rooms where someone has been working for a long time. It is not silence — the keyboard still ticks, the chair still creaks — but a settled hum, like a machine at equilibrium. Elena had been in that quiet for three hours when she finally wrote the sentence she had been circling all morning.

It was not a remarkable sentence. It would not be quoted or remembered. But it was true, and true sentences are the rarest kind, and when she wrote it she felt the specific satisfaction of a key turning in a lock that had resisted all day.`;

const REASONING_TEXT = 'The answer is 42. If you asked why, the reasoning above explains the chain of thought that produced it.';

const REASONING_PARTS = [
  REASONING(`The user wants to know why the sky is blue. Let me think through the physics.

Sunlight contains all visible wavelengths. When it enters the atmosphere, it collides with gas molecules much smaller than the wavelength of light.

Rayleigh scattering says shorter wavelengths scatter far more strongly — intensity scales with 1/λ⁴. Blue light (~450nm) scatters roughly 5x more than red (~700nm).

So blue light is scattered across the whole sky, and we see that scattered blue in every direction we look.

One subtlety: violet scatters even more, but the sun emits less violet and our eyes are less sensitive to it, so the sky reads blue, not violet.`),
  TEXT(REASONING_TEXT),
];

const TOOL_CALLS = [TOOL_CALL('get_weather'), TEXT('Here is what I found after looking it up.')];

const JSON_TEXT = JSON.stringify(
  {
    name: 'Ada Lovelace',
    role: 'admin',
    email: 'ada@example.com',
    tags: ['mathematics', 'computing', 'pioneer'],
    score: 0.98,
    active: true,
  },
  null,
  2,
);

const JSON_PARTS = [TEXT(JSON_TEXT)];

const IMAGE_PARTS = [
  TEXT('Here is the image you asked for:'),
  FILE('image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  TEXT('It is a 1x1 red pixel PNG generated by the mock provider.'),
];

const FILE_PARTS = [
  TEXT('Here is the generated file:'),
  FILE('text/plain', 'SGVsbG8gZnJvbSB0aGUgbW9jayBwcm92aWRlciE='),
  TEXT('The file above is a plain text file with a short greeting.'),
];

const ERROR_MESSAGE = 'The mock provider encountered a simulated failure mid-stream.';

const ERROR_PARTS = [
  TEXT('This part of the response streams normally. '),
  ERROR(ERROR_MESSAGE),
  TEXT('This text must never be emitted because the error interrupts the stream.'),
];

const MAX_TOKENS = [TEXT('This response is intentionally cut short by the token limit. The rest of this text will not be visible ')];

const DEFAULT_TEXT = `Hello from the AI mock provider!

This is the **default** response used when no scenario matches your prompt. Ask for:

- headings — markdown headings of every level
- tables — markdown tables
- code — fenced code blocks
- math — LaTeX formulas
- lists — ordered and unordered lists
- links — hyperlinks
- quotes — blockquotes
- long text — a multi-paragraph essay
- reasoning — thinking tokens before the answer
- json — structured JSON output
- image — a generated file part
- tools — tool calls
- errors — a mid-stream failure

Add a speed directive like *"30 tokens per second"* to control streaming speed.`;

const DEFAULT_PARTS = [TEXT(DEFAULT_TEXT)];

const defineScenario = (
  id: string,
  keywords: string[],
  parts: MockScenarioContent['parts'],
  finishReason: MockScenarioContent['finishReason'] = 'stop',
): MockScenario => ({
  id,
  keywords,
  parts: parts ?? [TEXT('')],
  finishReason: finishReason ?? 'stop',
});

export const DEFAULT_SCENARIOS: MockScenario[] = [
  defineScenario('headings', ['heading', 'headings', 'title', 'section'], [TEXT(HEADINGS)]),
  defineScenario('tables', ['table', 'tables', 'tabular', 'comparison', 'columns'], [TEXT(TABLES)]),
  defineScenario('code', ['code', 'snippet', 'function', 'typescript', 'javascript', 'python', 'program', 'implement'], [TEXT(CODE)]),
  defineScenario('math', ['math', 'formula', 'formulas', 'equation', 'equations', 'latex', 'katex', 'integral'], [TEXT(MATH)]),
  defineScenario('lists', ['list', 'lists', 'bullet', 'bullets', 'steps', 'checklist'], [TEXT(LISTS)]),
  defineScenario('links', ['link', 'links', 'hyperlink', 'citation', 'citations', 'url'], [TEXT(LINKS)]),
  defineScenario('blockquotes', ['quote', 'quotes', 'blockquote', 'quotation'], [TEXT(BLOCKQUOTES)]),
  defineScenario('long-text', ['long', 'essay', 'article', 'detailed', 'story'], [TEXT(LONG_TEXT)]),
  defineScenario('lorem', ['lorem', 'filler', 'dummy text', 'placeholder text', 'random text'], [{ type: 'lorem', unit: 'paragraphs', count: 3 }]),
  defineScenario('reasoning', ['think', 'thinking', 'reasoning', 'reason', 'why', 'explain your', 'step by step'], REASONING_PARTS),
  defineScenario('tool-calls', ['tool', 'weather', 'lookup', 'call a tool', 'use the tool'], TOOL_CALLS, 'tool-calls'),
  defineScenario(
    'provider-tools',
    ['provider tool', 'provider-executed', 'web search', 'built-in tool'],
    [
      { type: 'tool-call', toolName: 'web_search', input: { query: 'latest AI SDK release notes' } },
      {
        type: 'tool-result',
        toolName: 'web_search',
        result: { query: 'latest AI SDK release notes', sources: ['https://ai-sdk.dev/docs'], summary: 'The AI SDK team shipped a new release.' },
      },
      { type: 'text', text: 'Here is what I found after searching the web.' },
    ],
  ),
  defineScenario('json', ['json', 'structured', 'schema', 'object output'], JSON_PARTS),
  defineScenario('image-part', ['image', 'picture', 'photo', 'png'], IMAGE_PARTS),
  defineScenario('file-part', ['file', 'attachment', 'document', 'pdf', 'binary'], FILE_PARTS),
  defineScenario('error', ['error', 'fail', 'failure', 'crash', 'explode'], ERROR_PARTS, 'error'),
  defineScenario('max-tokens', ['max tokens', 'token limit', 'truncate', 'cut off', 'length limit'], MAX_TOKENS, 'length'),
  defineScenario('default', [], DEFAULT_PARTS),
];

export const scenarioFromSpecifier = (id: string, specifier: string | MockScenarioContent): MockScenario => {
  if (typeof specifier === 'string') {
    return { id, keywords: [], parts: [TEXT(specifier)], finishReason: 'stop' };
  }
  const parts = specifier.parts ?? (specifier.text !== undefined ? [TEXT(specifier.text)] : [TEXT('')]);
  return {
    id,
    keywords: specifier.keywords ?? [],
    parts,
    finishReason: specifier.finishReason ?? 'stop',
    tokensPerSecond: specifier.tokensPerSecond,
    firstTokenDelayMs: specifier.firstTokenDelayMs,
  };
};

export const resolveScenarioId = (modelId: string, scenarios: MockScenario[]): string | undefined => scenarios.find((scenario) => scenario.id === modelId)?.id;

export const matchScenarioByKeywords = (text: string, scenarios: MockScenario[]): MockScenario | undefined => {
  const normalized = text.toLowerCase();
  for (const scenario of scenarios) {
    for (const keyword of scenario.keywords) {
      const pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (pattern.test(normalized)) {
        return scenario;
      }
    }
  }
  return undefined;
};
