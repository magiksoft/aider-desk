import { describe, expect, it } from 'vitest';

import { estimateTokenCount, parseSpeedDirective, tokenize } from '../speed.js';

describe('parseSpeedDirective', () => {
  it('parses "t/s" notation', () => {
    const result = parseSpeedDirective('respond with tables at 30 t/s');
    expect(result.tokensPerSecond).toBe(30);
  });

  it('parses "tokens per second" notation', () => {
    const result = parseSpeedDirective('and 20 tokens per second please');
    expect(result.tokensPerSecond).toBe(20);
  });

  it('parses "tps" notation', () => {
    const result = parseSpeedDirective('go at 45 tps');
    expect(result.tokensPerSecond).toBe(45);
  });

  it('parses "tok/s" notation', () => {
    const result = parseSpeedDirective('12 tok/s');
    expect(result.tokensPerSecond).toBe(12);
  });

  it('parses fractional speeds', () => {
    const result = parseSpeedDirective('2.5 t/s');
    expect(result.tokensPerSecond).toBe(2.5);
  });

  it('is case insensitive', () => {
    const result = parseSpeedDirective('30 T/S');
    expect(result.tokensPerSecond).toBe(30);
  });

  it('parses "instant" as zero', () => {
    const result = parseSpeedDirective('answer instantly please');
    expect(result.tokensPerSecond).toBe(0);
  });

  it('strips the directive from the cleaned text', () => {
    const result = parseSpeedDirective('respond with tables at 30 t/s thanks');
    expect(result.cleanedText).toBe('respond with tables thanks');
  });

  it('returns null when no directive present', () => {
    const result = parseSpeedDirective('just answer normally');
    expect(result.tokensPerSecond).toBeNull();
    expect(result.cleanedText).toBe('just answer normally');
  });

  it('does not match unrelated numbers', () => {
    const result = parseSpeedDirective('show 30 rows in a table');
    expect(result.tokensPerSecond).toBeNull();
  });
});

describe('tokenize', () => {
  it('splits text into chunks of the given size', () => {
    expect(tokenize('abcdefgh', 4)).toEqual(['abcd', 'efgh']);
  });

  it('handles remainder chunks', () => {
    expect(tokenize('abcdef', 4)).toEqual(['abcd', 'ef']);
  });

  it('returns empty array for empty text', () => {
    expect(tokenize('', 4)).toEqual([]);
  });
});

describe('estimateTokenCount', () => {
  it('rounds up to at least one token', () => {
    expect(estimateTokenCount('abc', 4)).toBe(1);
    expect(estimateTokenCount('abcde', 4)).toBe(2);
    expect(estimateTokenCount('', 4)).toBe(1);
  });
});
