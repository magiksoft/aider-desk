import { describe, expect, it } from 'vitest';

import { generateLoremText, parseLoremDirective } from '../lorem.js';
import { createRng } from '../random.js';

describe('createRng', () => {
  it('produces deterministic sequences for the same seed', () => {
    const first = createRng(42);
    const second = createRng(42);
    const firstValues = Array.from({ length: 10 }, () => first());
    const secondValues = Array.from({ length: 10 }, () => second());
    expect(firstValues).toEqual(secondValues);
  });

  it('produces different sequences for different seeds', () => {
    const first = createRng(42);
    const second = createRng(43);
    expect(Array.from({ length: 10 }, () => first())).not.toEqual(Array.from({ length: 10 }, () => second()));
  });

  it('produces values in [0, 1)', () => {
    const rng = createRng(7);
    for (let index = 0; index < 1000; index++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('parseLoremDirective', () => {
  it('parses paragraph directives', () => {
    expect(parseLoremDirective('write 2 paragraphs of lorem')).toEqual({ unit: 'paragraphs', count: 2 });
  });

  it('parses sentence directives', () => {
    expect(parseLoremDirective('give me 4 sentences of filler')).toEqual({ unit: 'sentences', count: 4 });
  });

  it('parses word directives', () => {
    expect(parseLoremDirective('30 words of dummy text')).toEqual({ unit: 'words', count: 30 });
  });

  it('returns empty for prompts without a directive', () => {
    expect(parseLoremDirective('some lorem ipsum please')).toEqual({});
  });
});

describe('generateLoremText', () => {
  it('generates the requested number of paragraphs separated by blank lines', () => {
    const text = generateLoremText({ type: 'lorem', unit: 'paragraphs', count: 3 }, createRng(42));
    const paragraphs = text.split('\n\n').filter(Boolean);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.every((paragraph) => paragraph.length > 50)).toBe(true);
  });

  it('generates the requested number of words', () => {
    const text = generateLoremText({ type: 'lorem', unit: 'words', count: 25 }, createRng(42));
    expect(text.split(/\s+/).filter(Boolean)).toHaveLength(25);
  });

  it('generates the requested number of sentences', () => {
    const text = generateLoremText({ type: 'lorem', unit: 'sentences', count: 5 }, createRng(42));
    expect(text.split(/[.!?]+/).filter(Boolean)).toHaveLength(5);
  });

  it('is deterministic for the same seed and random otherwise', () => {
    const seededFirst = generateLoremText({ type: 'lorem', unit: 'paragraphs', count: 2 }, createRng(99));
    const seededSecond = generateLoremText({ type: 'lorem', unit: 'paragraphs', count: 2 }, createRng(99));
    const unseeded = generateLoremText({ type: 'lorem', unit: 'paragraphs', count: 2 }, createRng());
    expect(seededFirst).toBe(seededSecond);
    expect(seededFirst).not.toBe(unseeded);
  });
});
