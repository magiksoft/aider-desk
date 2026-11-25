export const DEFAULT_CHUNK_SIZE = 4;

const SPEED_PATTERN = new RegExp(
  [
    '(\\d+(?:\\.\\d+)?)\\s*(?:t\\/s|tok\\/s|toks\\/s|tokens\\/s|tps)',
    '(\\d+(?:\\.\\d+)?)\\s*tokens?\\s+per\\s+second',
    '(\\d+(?:\\.\\d+)?)\\s*toks?\\s+per\\s+sec(?:ond)?s?',
  ].join('|'),
  'i',
);

const SPEED_WITH_PARTICLE_PATTERN = new RegExp(`(?:\\b(?:at|with|speed|rate)\\s+)?${SPEED_PATTERN.source}`, 'i');

const INSTANT_PATTERN = /\b(?:instant(?:ly)?|no delay|as fast as possible|max speed)\b/i;

export type ParsedSpeed = {
  tokensPerSecond: number | null;
  cleanedText: string;
};

export const parseSpeedDirective = (text: string): ParsedSpeed => {
  const clean = (match: RegExpExecArray) =>
    (text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length))
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,!?])/g, '$1')
      .trim();

  const speedMatch = SPEED_WITH_PARTICLE_PATTERN.exec(text);
  if (speedMatch) {
    const value = Number.parseFloat(speedMatch[1] ?? speedMatch[2] ?? speedMatch[3]);
    if (Number.isFinite(value) && value > 0) {
      return { tokensPerSecond: value, cleanedText: clean(speedMatch) };
    }
  }

  const instantMatch = INSTANT_PATTERN.exec(text);
  if (instantMatch) {
    return { tokensPerSecond: 0, cleanedText: clean(instantMatch) };
  }

  return { tokensPerSecond: null, cleanedText: text };
};

export const tokenize = (text: string, chunkSize = DEFAULT_CHUNK_SIZE): string[] => {
  if (text.length === 0) {
    return [];
  }
  return text.match(new RegExp(`[\\s\\S]{1,${chunkSize}}`, 'g')) ?? [text];
};

export const sleep = async (ms: number, abortSignal?: AbortSignal): Promise<void> => {
  if (ms <= 0) {
    return;
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
};

export const estimateTokenCount = (text: string, chunkSize = DEFAULT_CHUNK_SIZE): number => Math.max(1, Math.ceil(text.length / chunkSize));
