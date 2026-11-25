import { MockLanguageModelV4 } from './model.js';
import { createRng } from './random.js';

import type { MockLanguageModel, MockProvider, MockProviderOptions } from './types.js';

export const createMockProvider = (options: MockProviderOptions = {}): MockProvider => {
  const rng = createRng(options.seed);
  const createModel = (modelId: string): MockLanguageModel => new MockLanguageModelV4(modelId, options, rng);

  const provider = createModel as MockProvider;
  provider.languageModel = createModel;
  provider.chat = createModel;

  return provider;
};
