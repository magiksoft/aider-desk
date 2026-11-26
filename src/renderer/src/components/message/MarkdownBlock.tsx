import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import { MarkdownLink } from './MarkdownLink';
import { MarkdownImage } from './MarkdownImage';
import { messageUrlTransform } from './markdown-url';

import { CodeInline } from '@/components/common/CodeInline';
import { MermaidDiagram } from '@/components/common/MermaidDiagram';

export const REMARK_PLUGINS = [remarkGfm, remarkMath];
export const REHYPE_PLUGINS = [rehypeKatex];
export const MARKDOWN_COMPONENTS: Components = {
  h1: (props) => <h1 className="text-2xl font-bold my-4 first:mt-0 last:mb-0" {...props} />,
  h2: (props) => <h2 className="text-xl font-bold my-3 first:mt-0 last:mb-0" {...props} />,
  h3: (props) => <h3 className="text-lg font-bold my-2 first:mt-0 last:mb-0" {...props} />,
  h4: (props) => <h4 className="text-base font-bold my-1 first:mt-0 last:mb-0" {...props} />,
  h5: (props) => <h5 className="text-sm font-bold first:mt-0 last:mb-0" {...props} />,
  h6: (props) => <h6 className="text-xs font-bold first:mt-0 last:mb-0" {...props} />,
  p: (props) => <p className="text-xs my-2 first:mt-0 last:mb-0" {...props} />,
  ul: (props) => <ul className="list-disc list-inside ml-2 my-1 first:mt-0 last:mb-0" {...props} />,
  ol: (props) => <ol className="list-decimal list-inside ml-2 my-1 first:mt-0 last:mb-0" {...props} />,
  li: (props) => <li className="my-0.5 [&>p]:inline [&>p]:my-0" {...props} />,
  blockquote: (props) => <blockquote className="border-l-4 border-border-default pl-4 italic my-0 text-text-muted-light" {...props} />,
  strong: (props) => <strong className="font-bold" {...props} />,
  em: (props) => <em className="italic" {...props} />,
  a: ({ href, children, title }) => (
    <MarkdownLink href={href} title={title}>
      {children}
    </MarkdownLink>
  ),
  // Handle code blocks - check if it's a mermaid diagram or regular code
  code: (props) => {
    const { className, children } = props;

    // Check if this is a mermaid code block (className includes 'language-mermaid')
    const language = className?.replace(/language-/, '') || '';
    if (language === 'mermaid' && typeof children === 'string') {
      return <MermaidDiagram code={children} />;
    }

    // Use CodeInline for inline code elements
    return <CodeInline {...props} />;
  },
  // Basic styling for preformatted blocks (e.g., indented code)
  pre: (props) => <pre className="p-2 rounded my-2 overflow-x-auto" {...props} />,
  // Table styling - wrapped in scrollable container for wide tables
  table: (props) => (
    <div className="overflow-x-auto scrollbar-thin scrollbar-track-bg-primary-light scrollbar-thumb-bg-secondary-light hover:scrollbar-thumb-bg-tertiary">
      <table className="divide-y divide-border-default border-border-default mb-2 rounded-sm" {...props} />
    </div>
  ),
  thead: (props) => <thead className="bg-bg-secondary-light" {...props} />,
  tbody: (props) => <tbody className="bg-bg-primary-light-strong divide-y divide-border-default" {...props} />,
  tr: (props) => <tr {...props} />,
  th: (props) => <th className="px-5 py-2 text-left text-xs font-medium text-text-secondary uppercase tracking-wider" {...props} />,
  td: (props) => <td className="px-4 py-2 text-xs text-text-primary whitespace-nowrap" {...props} />,
};

type Props = {
  content: string;
  baseDir: string;
  taskId?: string;
};

const MarkdownBlockInner = ({ content, baseDir, taskId }: Props) => {
  return (
    <ReactMarkdown
      urlTransform={messageUrlTransform}
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={{
        ...MARKDOWN_COMPONENTS,
        a: ({ href, children, title }) => (
          <MarkdownLink href={href} title={title} baseDir={baseDir} taskId={taskId}>
            {children}
          </MarkdownLink>
        ),
        img: ({ src, alt, title }) => <MarkdownImage src={src} alt={alt} title={title} baseDir={baseDir} taskId={taskId} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
};

export const MarkdownBlock = memo(MarkdownBlockInner);
