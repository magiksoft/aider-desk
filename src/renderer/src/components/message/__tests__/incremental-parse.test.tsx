import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseMessageContent } from '../utils';

import type { ComponentProps, ReactElement, ReactNode } from 'react';

const markdownContentKeys = (parts: ReactNode[]): Map<string, string> => {
  const keys = new Map<string, string>();
  for (const part of parts) {
    if (part && typeof part === 'object' && 'key' in part && 'props' in part && part.key !== null) {
      const props = (part as ReactElement).props as { content?: unknown };
      if (typeof props.content === 'string') {
        keys.set(props.content, part.key);
      }
    }
  }
  return keys;
};

const partKey = (part: ReactNode): string | null => (part && typeof part === 'object' && 'key' in part ? part.key : null);

import { useParsedContent } from '@/hooks/useParsedContent';
import { render } from '@/__tests__/render';

const mocks = vi.hoisted(() => ({
  renderCounts: new Map<string, number>(),
}));

vi.mock('../MarkdownBlock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../MarkdownBlock')>();
  const { memo } = await import('react');
  const CountingMarkdownBlock = (props: ComponentProps<typeof actual.MarkdownBlock>) => {
    mocks.renderCounts.set(props.content, (mocks.renderCounts.get(props.content) ?? 0) + 1);
    return <actual.MarkdownBlock {...props} />;
  };
  return { ...actual, MarkdownBlock: memo(CountingMarkdownBlock) };
});

vi.mock('@/components/common/CodeBlock', () => ({
  CodeBlock: ({ file, language, children }: { file?: string; language: string; children?: ReactNode }) => (
    <pre data-language={language} data-file={file ?? ''}>
      {children}
    </pre>
  ),
}));

const BASE_DIR = '/project';

const parse = (content: string, taskId: string, allFiles: string[] | ReadonlySet<string> = [], renderMarkdown = true) => (
  <>{parseMessageContent(BASE_DIR, content, allFiles, renderMarkdown, true, undefined, taskId)}</>
);

const chunkify = (text: string, size: number): string[] => {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
};

const normalizeHtml = (html: string): string => html.replace(/ style=""/g, '');

type StreamOptions = {
  allFiles?: string[] | ReadonlySet<string>;
  renderMarkdown?: boolean;
  chunkSize?: number;
};

const streamAndCompare = (content: string, options: StreamOptions = {}, taskId = 'stream'): ReturnType<typeof render> => {
  const { allFiles = [], renderMarkdown = true, chunkSize = 12 } = options;
  const chunks = chunkify(content, chunkSize);
  const streamed = render(parse(chunks[0], taskId, allFiles, renderMarkdown));

  const renderBaseline = (current: string, step: number) => {
    const baseline = render(parse(current, `${taskId}-full-${step}`, allFiles, renderMarkdown));
    const html = baseline.container.innerHTML;
    baseline.unmount();
    return html;
  };

  expect(normalizeHtml(streamed.container.innerHTML)).toBe(normalizeHtml(renderBaseline(chunks[0], 0)));

  for (let step = 1; step < chunks.length; step++) {
    const current = chunks.slice(0, step + 1).join('');
    streamed.rerender(parse(current, taskId, allFiles, renderMarkdown));
    expect(normalizeHtml(streamed.container.innerHTML)).toBe(normalizeHtml(renderBaseline(current, step)));
  }
  return streamed;
};

beforeEach(() => {
  mocks.renderCounts.clear();
});

describe('incremental parseMessageContent', () => {
  it('matches a full parse for multi-paragraph markdown with headings, lists, tables and math', () => {
    const content = [
      '# Main Heading',
      '',
      'An intro paragraph with **bold** and *italic* text.',
      '',
      '- first item',
      '- second item',
      '  - nested item',
      '',
      '| Col A | Col B |',
      '| ----- | ----- |',
      '| one   | two   |',
      '',
      '$$',
      'c = \\pm\\sqrt{a^2 + b^2}',
      '$$',
      '',
      'Closing paragraph after the math block.',
    ].join('\n');

    const streamed = streamAndCompare(content, {}, 'rich-md');
    expect(streamed.container.querySelector('h1')).not.toBeNull();
    expect(streamed.container.querySelectorAll('li').length).toBe(3);
    expect(streamed.container.querySelector('table')).not.toBeNull();
    expect(streamed.container.querySelector('.katex')).not.toBeNull();
  });

  it('matches a full parse for prose with fenced code blocks and file detection on previous and next lines', () => {
    const content = [
      'Intro text before the code.',
      '',
      'src/app.ts',
      '```ts',
      'const x = 1;',
      '```',
      '',
      'Middle text between blocks.',
      '',
      '```js',
      'src/app.ts',
      'const y = 2;',
      '```',
      '',
      'Outro text after the code.',
    ].join('\n');

    const streamed = streamAndCompare(content, { allFiles: ['src/app.ts'] }, 'code-files');
    expect(streamed.container.querySelectorAll('pre[data-file="src/app.ts"]').length).toBe(2);
    expect(streamed.container.querySelector('pre[data-language="ts"]')).not.toBeNull();
    expect(streamed.container.querySelector('pre[data-language="js"]')).not.toBeNull();
    expect(streamed.container.textContent).not.toContain('src/app.ts');
  });

  it('matches a full parse for custom-command-bash, compacted-edits and file-edited blocks', () => {
    const content = [
      'Before the tag blocks.',
      '',
      '<custom-command-bash>',
      '<command>npm test</command>',
      '<output>all tests passed</output>',
      '</custom-command-bash>',
      '',
      'Between the tag blocks.',
      '',
      '<compacted-edits>',
      '- src/a.ts',
      '- src/b.ts',
      '</compacted-edits>',
      '',
      '<file-edited path="src/c.ts">',
      '',
      'After all the tag blocks.',
    ].join('\n');

    const streamed = streamAndCompare(content, {}, 'tag-blocks');
    expect(streamed.container.textContent).toContain('npm test');
    expect(streamed.container.textContent).toContain('a.ts');
    expect(streamed.container.textContent).toContain('c.ts');
    expect(streamed.container.textContent).toContain('After all the tag blocks.');
  });

  it('matches a full parse in non-markdown mode with inline backticks and code blocks', () => {
    const content = ['Plain text with `inline code` here.', '', '```python', 'print("hello")', '```', '', 'More `ticks` and plain text.'].join('\n');

    const streamed = streamAndCompare(content, { renderMarkdown: false }, 'plain-mode');
    expect(streamed.container.querySelectorAll('pre[data-language="python"]').length).toBe(1);
  });

  it('falls back to a full parse and resolves a late link reference definition and footnote', () => {
    const content = [
      'Check the [guide] for details.',
      '',
      'Second paragraph of settled prose.',
      '',
      '[guide]: https://example.com/docs',
      '',
      '[^1]: the late footnote note',
    ].join('\n');

    const streamed = streamAndCompare(content, {}, 'late-refs');
    const link = streamed.container.querySelector('a[href="https://example.com/docs"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe('guide');
  });

  it('does not leak stale settled parts when content shrinks, resets or is replaced', () => {
    const long = 'First paragraph of the original content.\n\nSecond paragraph of the original content.';
    const replacement = 'A completely different replacement text.';

    const streamed = streamAndCompare(long, {}, 'reset-stream');
    expect(streamed.container.textContent).toContain('Second paragraph of the original content.');

    streamed.rerender(parse(replacement, 'reset-stream'));
    const baseline = render(parse(replacement, 'reset-expected'));
    expect(streamed.container.innerHTML).toBe(baseline.container.innerHTML);
    expect(streamed.container.textContent).not.toContain('First paragraph of the original content.');
    baseline.unmount();

    const regrown = `${replacement}\n\nAn appended paragraph after the reset.`;
    streamed.rerender(parse(regrown, 'reset-stream'));
    const regrownBaseline = render(parse(regrown, 'reset-expected-2'));
    expect(streamed.container.innerHTML).toBe(regrownBaseline.container.innerHTML);
    regrownBaseline.unmount();

    const truncated = long.split('\n\n')[0];
    streamed.rerender(parse(truncated, 'reset-stream'));
    const truncatedBaseline = render(parse(truncated, 'reset-expected-3'));
    expect(streamed.container.innerHTML).toBe(truncatedBaseline.container.innerHTML);
    truncatedBaseline.unmount();
  });

  it('performs set-based file lookups for both string arrays and ReadonlySet inputs', () => {
    const content = ['Intro paragraph.', '', 'src/app.ts', '```ts', 'const x = 1;', '```', '', 'Closing paragraph.'].join('\n');

    const fromArray = streamAndCompare(content, { allFiles: ['src/app.ts'] }, 'files-array');
    const fromSet = streamAndCompare(content, { allFiles: new Set(['src/app.ts']) }, 'files-set');

    expect(fromArray.container.innerHTML).toBe(fromSet.container.innerHTML);
    expect(fromSet.container.querySelectorAll('pre[data-file="src/app.ts"]').length).toBe(1);
  });

  it('reuses settled MarkdownBlock instances while only parsing the unsettled suffix', () => {
    const content = [
      'First paragraph that settles early.',
      '',
      'Second paragraph with more streaming text.',
      '',
      'Third paragraph arrives later on.',
      '',
      'Fourth and final paragraph here.',
    ].join('\n');

    const chunks = chunkify(content, 12);
    const { result, rerender } = renderHook(
      ({ currentContent }: { currentContent: string }) => useParsedContent(BASE_DIR, currentContent, ['src/app.ts'], true, true, undefined, 'hook-stream'),
      { initialProps: { currentContent: chunks[0] } },
    );

    const rendered: ReactNode[][] = [];
    const first = result.current;
    expect(first).not.toBeNull();
    rendered.push(first as ReactNode[]);

    for (let step = 1; step < chunks.length; step++) {
      rerender({ currentContent: chunks.slice(0, step + 1).join('') });
      rendered.push(result.current as ReactNode[]);
    }

    for (const count of mocks.renderCounts.values()) {
      expect(count).toBe(1);
    }

    for (let step = 1; step < rendered.length; step++) {
      const previous = rendered[step - 1];
      const current = rendered[step];
      for (let partIndex = 0; partIndex < Math.min(previous.length, current.length); partIndex++) {
        expect(partKey(current[partIndex])).toBe(partKey(previous[partIndex]));
      }
    }

    const finalParts = rendered[rendered.length - 1];
    const previousParts = rendered[rendered.length - 2];
    expect(finalParts[0]).toBe(previousParts[0]);
    expect(finalParts[1]).toBe(previousParts[1]);
  });

  it('keeps settled elements stable for code blocks and file detection during streaming', () => {
    const content = ['First the intro text.', '', 'src/app.ts', '```ts', 'const x = 1;', '```', '', 'Then more streaming prose follows here.'].join('\n');

    const chunks = chunkify(content, 12);
    const { result, rerender } = renderHook(
      ({ currentContent }: { currentContent: string }) => useParsedContent(BASE_DIR, currentContent, ['src/app.ts'], true, true, undefined, 'hook-code'),
      { initialProps: { currentContent: chunks[0] } },
    );

    const rendered: ReactNode[][] = [];
    rendered.push(result.current as ReactNode[]);
    for (let step = 1; step < chunks.length; step++) {
      rerender({ currentContent: chunks.slice(0, step + 1).join('') });
      rendered.push(result.current as ReactNode[]);
    }

    for (const count of mocks.renderCounts.values()) {
      expect(count).toBe(1);
    }
    expect(rendered[rendered.length - 1].length).toBeGreaterThan(2);

    for (let step = 1; step < rendered.length; step++) {
      const previous = markdownContentKeys(rendered[step - 1]);
      const current = markdownContentKeys(rendered[step]);
      for (const [content, key] of previous) {
        for (const [currentContent, currentKey] of current) {
          if (currentContent === content || currentContent.startsWith(content)) {
            expect(currentKey).toBe(key);
            break;
          }
        }
      }
    }
  });
});
