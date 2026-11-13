import { useMemo } from 'react';

import { parseMessageContent } from '@/components/message/utils';

export const useParsedContent = (
  baseDir: string,
  content: string | null | undefined,
  allFiles: string[],
  renderMarkdown?: boolean,
  renderThinking?: boolean,
  reasoning?: string | null,
  taskId?: string,
) => {
  return useMemo(() => {
    if (!content && !reasoning) {
      return null;
    }
    return parseMessageContent(baseDir, content || '', allFiles, renderMarkdown, renderThinking, reasoning, taskId);
  }, [baseDir, content, reasoning, renderMarkdown, renderThinking, allFiles, taskId]);
};
