import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMarkdownComponents, MARKDOWN_COMPONENTS, MarkdownBlock } from '../MarkdownBlock';
import { parseMessageContent } from '../utils';

import type { ComponentProps, ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  renderCounts: new Map<string, number>(),
  lifecycleLog: [] as string[],
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

vi.mock('../MarkdownLink', async () => {
  const { useEffect } = await import('react');
  const MarkdownLinkSpy = ({ href, children }: { href?: string; children?: ReactNode }) => {
    useEffect(() => {
      mocks.lifecycleLog.push('link-mount');
      return () => {
        mocks.lifecycleLog.push('link-unmount');
      };
    }, []);
    return <a href={href}>{children}</a>;
  };
  return { MarkdownLink: MarkdownLinkSpy };
});

vi.mock('../MarkdownImage', async () => {
  const { useEffect } = await import('react');
  const MarkdownImageSpy = ({ alt }: { alt?: string }) => {
    useEffect(() => {
      mocks.lifecycleLog.push('image-mount');
      return () => {
        mocks.lifecycleLog.push('image-unmount');
      };
    }, []);
    return <img alt={alt} />;
  };
  return { MarkdownImage: MarkdownImageSpy };
});

vi.mock('@/components/common/CodeBlock', () => ({ CodeBlock: () => null }));

beforeEach(() => {
  mocks.renderCounts.clear();
  mocks.lifecycleLog.length = 0;
});

describe('getMarkdownComponents', () => {
  it('returns the same components object and a/img references for identical baseDir and taskId', () => {
    const first = getMarkdownComponents('/project', 'task-1');
    const second = getMarkdownComponents('/project', 'task-1');

    expect(second).toBe(first);
    expect(second.a).toBe(first.a);
    expect(second.img).toBe(first.img);
  });

  it('returns the same object when taskId is omitted consistently', () => {
    expect(getMarkdownComponents('/project')).toBe(getMarkdownComponents('/project'));
  });

  it('returns distinct components when baseDir or taskId differs', () => {
    const base = getMarkdownComponents('/project', 'task-1');

    expect(getMarkdownComponents('/other', 'task-1')).not.toBe(base);
    expect(getMarkdownComponents('/project', 'task-2')).not.toBe(base);
    expect(getMarkdownComponents('/project')).not.toBe(base);
  });

  it('spreads MARKDOWN_COMPONENTS entries and only overrides a and img', () => {
    const components = getMarkdownComponents('/project', 'task-1');

    expect(components.p).toBe(MARKDOWN_COMPONENTS.p);
    expect(components.code).toBe(MARKDOWN_COMPONENTS.code);
    expect(components.table).toBe(MARKDOWN_COMPONENTS.table);
    expect(components.a).not.toBe(MARKDOWN_COMPONENTS.a);
    expect(components.img).not.toBe(MARKDOWN_COMPONENTS.img);
  });

  it('evicts old entries beyond the cache limit so the cache stays bounded', () => {
    const initial = getMarkdownComponents('/cache-eviction', 'first');
    for (let i = 0; i < 150; i += 1) {
      getMarkdownComponents('/cache-eviction', `entry-${i}`);
    }

    expect(getMarkdownComponents('/cache-eviction', 'first')).not.toBe(initial);
  });
});

describe('streaming rendering via parseMessageContent', () => {
  it('does not re-render settled blocks while only the trailing block streams', () => {
    const messageFor = (content: string) => parseMessageContent('/project', content, [], true, true, undefined, 'task-1');
    const { rerender } = render(<>{messageFor('Settled one\n\nSettled two\n\nActive paragraph')}</>);
    rerender(<>{messageFor('Settled one\n\nSettled two\n\nActive paragraph continued')}</>);
    rerender(<>{messageFor('Settled one\n\nSettled two\n\nActive paragraph continued again')}</>);

    expect(mocks.renderCounts.get('Settled one')).toBe(1);
    expect(mocks.renderCounts.get('Settled two')).toBe(1);
    expect(mocks.renderCounts.get('Active paragraph')).toBe(1);
    expect(mocks.renderCounts.get('Active paragraph continued')).toBe(1);
    expect(mocks.renderCounts.get('Active paragraph continued again')).toBe(1);
  });
});

describe('streaming updates inside an active MarkdownBlock', () => {
  it('preserves the link instance across content updates', () => {
    const { rerender, container } = render(<MarkdownBlock content="[Docs](https://example.com)" baseDir="/project" taskId="task-1" />);
    const anchor = container.querySelector('a');

    rerender(<MarkdownBlock content="[Docs](https://example.com) with more text" baseDir="/project" taskId="task-1" />);
    rerender(<MarkdownBlock content="[Docs](https://example.com) with more text and even more" baseDir="/project" taskId="task-1" />);

    expect(mocks.lifecycleLog).toEqual(['link-mount']);
    expect(container.querySelector('a')).toBe(anchor);
  });

  it('preserves the image instance across content updates', () => {
    const { rerender, container } = render(<MarkdownBlock content="![Logo](https://example.com/logo.png)" baseDir="/project" taskId="task-1" />);
    const image = container.querySelector('img');

    rerender(<MarkdownBlock content="![Logo](https://example.com/logo.png) and more text" baseDir="/project" taskId="task-1" />);

    expect(mocks.lifecycleLog).toEqual(['image-mount']);
    expect(container.querySelector('img')).toBe(image);
  });
});
