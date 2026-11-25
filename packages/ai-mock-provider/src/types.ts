export type MockFinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'interrupted' | 'other';

export type MockPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolName: string; input?: Record<string, unknown> }
  | { type: 'tool-result'; toolName: string; result?: Record<string, unknown>; isError?: boolean }
  | { type: 'file'; mediaType: string; data: string }
  | { type: 'lorem'; unit: 'words' | 'sentences' | 'paragraphs'; count: number }
  | { type: 'error'; message: string };

export type MockLoremPart = Extract<MockPart, { type: 'lorem' }>;

export type MockLoremOptions = {
  unit?: 'words' | 'sentences' | 'paragraphs';
  count?: number;
  sentencesPerParagraph?: { min: number; max: number };
  wordsPerSentence?: { min: number; max: number };
};

export type MockScenarioContent = {
  text?: string;
  parts?: MockPart[];
  finishReason?: MockFinishReason;
  keywords?: string[];
  tokensPerSecond?: number;
  firstTokenDelayMs?: number;
};

export type MockScenario = {
  id: string;
  keywords: string[];
  parts: MockPart[];
  finishReason: MockFinishReason;
  tokensPerSecond?: number;
  firstTokenDelayMs?: number;
};

export type MockResponseSpecifier = string | MockScenarioContent;

export type MockProviderOptions = {
  tokensPerSecond?: number;
  firstTokenDelayMs?: number;
  chunkSize?: number;
  defaultScenario?: string;
  scenarios?: Record<string, string | MockScenarioContent>;
  responses?: MockResponseSpecifier[];
  seed?: number;
  lorem?: MockLoremOptions;
  toolInputs?: Record<string, Record<string, unknown>>;
};

export type MockCallInfo = {
  modelId: string;
  scenarioId: string;
  prompt: string;
  tokensPerSecond: number;
  firstTokenDelayMs: number;
  timestamp: Date;
};

export type MockProvider = {
  (modelId: string): MockLanguageModel;
  languageModel(modelId: string): MockLanguageModel;
  chat(modelId: string): MockLanguageModel;
};

export interface MockLanguageModel {
  readonly specificationVersion: 'v4';
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]>;
  readonly calls: MockCallInfo[];
  doGenerate(options: import('@ai-sdk/provider').LanguageModelV4CallOptions): PromiseLike<import('@ai-sdk/provider').LanguageModelV4GenerateResult>;
  doStream(options: import('@ai-sdk/provider').LanguageModelV4CallOptions): PromiseLike<import('@ai-sdk/provider').LanguageModelV4StreamResult>;
}
