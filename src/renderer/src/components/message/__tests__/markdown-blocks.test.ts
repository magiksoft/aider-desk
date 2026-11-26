import { describe, expect, it } from 'vitest';

import { normalizeListBlocks, splitMarkdownBlocks } from '../markdown-blocks';

describe('splitMarkdownBlocks', () => {
  it('returns an empty array for empty or blank text', () => {
    expect(splitMarkdownBlocks('')).toEqual([]);
    expect(splitMarkdownBlocks('   \n\n  \n')).toEqual([]);
  });

  it('returns a single block when there are no blank lines', () => {
    const text = 'One line of text\nwithout any blank line';
    expect(splitMarkdownBlocks(text)).toEqual([text]);
  });

  it('splits simple paragraphs on blank lines', () => {
    expect(splitMarkdownBlocks('Para one.\n\nPara two.')).toEqual(['Para one.', 'Para two.']);
  });

  it('splits on blank-line runs containing whitespace-only lines', () => {
    expect(splitMarkdownBlocks('A\n\n   \n\t\nB')).toEqual(['A', 'B']);
  });

  it('splits headings from surrounding text', () => {
    expect(splitMarkdownBlocks('# Title\n\n## Section\n\nBody text')).toEqual(['# Title', '## Section', 'Body text']);
  });

  it('keeps a GFM table intact as a single block', () => {
    const table = ['| Name | Value |', '| ---- | ----- |', '| a    | 1     |', '| b    | 2     |'].join('\n');
    expect(splitMarkdownBlocks(`Before\n\n${table}\n\nAfter`)).toEqual(['Before', table, 'After']);
  });

  it('keeps multi-line $$ math blocks intact', () => {
    const math = '$$\n\\frac{a}{b} + \\sqrt{c}\n$$';
    expect(splitMarkdownBlocks(`Before\n\n${math}\n\nAfter`)).toEqual(['Before', math, 'After']);
  });

  it('keeps single-line $$ math as a normal block without corrupting state', () => {
    expect(splitMarkdownBlocks('Intro\n\n$$x^2$$ is a formula\n\nOutro')).toEqual(['Intro', '$$x^2$$ is a formula', 'Outro']);
  });

  it('keeps tilde fences remaining in prose intact, including blank lines inside', () => {
    const fence = '~~~python\nprint(1)\n\nstill code\n~~~';
    expect(splitMarkdownBlocks(`Para\n\n${fence}\n\nAfter`)).toEqual(['Para', fence, 'After']);
  });

  it('keeps backtick fences reaching the splitter intact', () => {
    const fence = '```\ncode line\n```';
    expect(splitMarkdownBlocks(`text\n\n${fence}\n\nmore`)).toEqual(['text', fence, 'more']);
  });

  it('keeps loose lists (blank lines between items) as a single block', () => {
    const list = '- item 1\n\n- item 2\n\n- item 3';
    expect(splitMarkdownBlocks(list)).toEqual([list]);
  });

  it('keeps indented continuations of list items inside the list block', () => {
    const list = '- item 1\n\n  continued line\n\n- item 2';
    expect(splitMarkdownBlocks(list)).toEqual([list]);
  });

  it('ends a list block at a top-level paragraph', () => {
    expect(splitMarkdownBlocks('- a\n\n- b\n\nNew paragraph')).toEqual(['- a\n\n- b', 'New paragraph']);
  });

  it('does not merge a list that follows a paragraph separated by a blank line', () => {
    expect(splitMarkdownBlocks('Paragraph\n\n- item')).toEqual(['Paragraph', '- item']);
  });

  it('keeps consecutive blockquotes as a single block', () => {
    const quotes = '> quote 1\n\n> quote 2';
    expect(splitMarkdownBlocks(quotes)).toEqual([quotes]);
  });

  it('ends a blockquote block at a top-level paragraph', () => {
    expect(splitMarkdownBlocks('> quote\n\nAfter')).toEqual(['> quote', 'After']);
  });

  it('normalizes ordered lists that directly follow non-list text', () => {
    expect(splitMarkdownBlocks('Some text\n2. Second item')).toEqual(['Some text\n\n2. Second item']);
  });

  it('does not insert blank lines inside already-loose ordered lists', () => {
    expect(splitMarkdownBlocks('1. First\n\n2. Second')).toEqual(['1. First\n\n2. Second']);
  });

  it('falls back to a single block when link reference definitions are present', () => {
    const text = 'Text with [a link][ref].\n\n[ref]: https://example.com';
    expect(splitMarkdownBlocks(text)).toEqual([text]);
  });

  it('falls back to a single block when footnotes are present', () => {
    const text = 'Statement[^1]\n\n[^1]: The note.';
    expect(splitMarkdownBlocks(text)).toEqual([text]);
  });

  it('normalizes list blocks in the link reference / footnote fallback', () => {
    const linkRefText = 'Intro\n2. Second item\n\n[ref]: https://example.com';
    expect(splitMarkdownBlocks(linkRefText)).toEqual(['Intro\n\n2. Second item\n\n[ref]: https://example.com']);

    const footnoteText = 'Intro\n2. Second item\n\n[^1]: The note.';
    expect(splitMarkdownBlocks(footnoteText)).toEqual(['Intro\n\n2. Second item\n\n[^1]: The note.']);
  });

  it('is prefix-stable while streaming appends chunks', () => {
    const fullText = [
      '# Heading',
      '',
      'Intro paragraph with some text.',
      '',
      '- item 1',
      '- item 2',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '$$',
      'E = mc^2',
      '$$',
      '',
      'Final paragraph.',
    ].join('\n');

    let previousBlocks: string[] = [];
    for (let end = 1; end <= fullText.length; end++) {
      const blocks = splitMarkdownBlocks(fullText.slice(0, end));
      const settled = previousBlocks.slice(0, -1);
      expect(blocks.slice(0, settled.length)).toEqual(settled);
      previousBlocks = blocks;
    }

    expect(previousBlocks).toEqual(splitMarkdownBlocks(fullText));
  });
});

describe('normalizeListBlocks', () => {
  it('inserts a blank line before an ordered list following regular text', () => {
    expect(normalizeListBlocks('Intro\n1. First')).toBe('Intro\n\n1. First');
  });

  it('leaves consecutive ordered list items untouched', () => {
    expect(normalizeListBlocks('1. First\n2. Second')).toBe('1. First\n2. Second');
  });
});
