import { useMemo } from 'react';

import { parseMessageContent } from '@/components/message/utils';

export const useParsedContent = (
  baseDir: string,
  content: string | null | undefined,
  allFiles: string[] | ReadonlySet<string>,
  renderMarkdown?: boolean,
  renderThinking?: boolean,
  reasoning?: string | null,
  taskId?: string,
) => {
  const allFilesSet = useMemo(() => (allFiles instanceof Set ? allFiles : new Set(allFiles)), [allFiles]);

  return useMemo(() => {
    if (!content && !reasoning) {
      return null;
    }
    return parseMessageContent(baseDir, content || '', allFilesSet, renderMarkdown, renderThinking, reasoning, taskId);
  }, [baseDir, content, reasoning, renderMarkdown, renderThinking, allFilesSet, taskId]);
};
