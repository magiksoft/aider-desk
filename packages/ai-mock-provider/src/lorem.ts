import { LoremIpsum } from 'lorem-ipsum';

import type { MockLoremOptions, MockLoremPart } from './types.js';

export type ResolvedLoremOptions = {
  unit: 'words' | 'sentences' | 'paragraphs';
  count: number;
  sentencesPerParagraph: { min: number; max: number };
  wordsPerSentence: { min: number; max: number };
};

export const DEFAULT_LOREM_OPTIONS: ResolvedLoremOptions = {
  unit: 'paragraphs',
  count: 3,
  sentencesPerParagraph: { min: 3, max: 7 },
  wordsPerSentence: { min: 6, max: 14 },
};

const resolveLoremOptions = (options?: MockLoremOptions): ResolvedLoremOptions => ({
  unit: options?.unit ?? DEFAULT_LOREM_OPTIONS.unit,
  count: options?.count ?? DEFAULT_LOREM_OPTIONS.count,
  sentencesPerParagraph: options?.sentencesPerParagraph ?? DEFAULT_LOREM_OPTIONS.sentencesPerParagraph,
  wordsPerSentence: options?.wordsPerSentence ?? DEFAULT_LOREM_OPTIONS.wordsPerSentence,
});

const LOREM_DIRECTIVE_REGEX = /(\d+)\s*(paragraphs?|sentences?|words?)\b/i;

export const parseLoremDirective = (text: string): { unit?: ResolvedLoremOptions['unit']; count?: number } => {
  const match = LOREM_DIRECTIVE_REGEX.exec(text);
  if (!match) {
    return {};
  }
  const unitRaw = match[2].toLowerCase();
  const unit = unitRaw.startsWith('word') ? 'words' : unitRaw.startsWith('sentence') ? 'sentences' : 'paragraphs';
  return { unit, count: Number.parseInt(match[1], 10) };
};

export const generateLoremText = (part: MockLoremPart, rng: () => number, config?: MockLoremOptions): string => {
  const base = resolveLoremOptions(config);
  const generator = new LoremIpsum(
    {
      random: rng,
      sentencesPerParagraph: base.sentencesPerParagraph,
      wordsPerSentence: base.wordsPerSentence,
    },
    'plain',
    '\n\n',
  );

  if (part.unit === 'words') {
    return generator.generateWords(part.count);
  }
  if (part.unit === 'sentences') {
    return generator.generateSentences(part.count);
  }
  return generator.generateParagraphs(part.count);
};
