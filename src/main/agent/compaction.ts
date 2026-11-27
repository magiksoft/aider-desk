import { v4 as uuidv4 } from 'uuid';

import { CompactionLevel, smartCompactMessages } from './smart-compaction';
import { convertImageToolResults } from './message-preparation/provider-compatibility';
import { estimateMessageTokens } from './utils';

import type { ModelMessage } from 'ai';
import type { SmartCompactionOptions } from '@common/extensions';
import type { AgentProfile, ContextMessage, PromptContext } from '@common/types';
import type { Task } from '@/task';

import { translate } from '@/utils/i18n';

export { CompactionLevel, smartCompactMessages } from './smart-compaction';
export type { SmartCompactionPass, SmartCompactionPassSelection } from './smart-compaction';

type SmartCompactionTokenTarget = {
  tokensBefore: number;
  threshold: number;
};

export type TaskSmartCompactionOptions = SmartCompactionOptions & {
  /** Try stronger levels to reach this estimated token limit. An explicit compactionLevel is the starting level, not a fixed level.
   * The protection window and selected passes still apply at every level, even if they prevent reaching the target.
   */
  tokenTarget?: SmartCompactionTokenTarget;
};

export const estimateContextMessageTokens = (messages: ContextMessage[]): number =>
  estimateMessageTokens(convertImageToolResults(messages.filter((message) => message.role !== 'log') as ModelMessage[]));

export const smartCompactToTokenTarget = async (
  messages: ContextMessage[],
  startingLevel: CompactionLevel,
  target: SmartCompactionTokenTarget,
  options?: Pick<SmartCompactionOptions, 'protectedMessageCount' | 'passes'>,
) => {
  const historyTokens = estimateContextMessageTokens(messages);
  // Anchor the history delta to measured usage, which includes prompt and tool overhead.
  const scale = historyTokens > target.tokensBefore ? target.tokensBefore / historyTokens : 1;
  const compactAt = async (level: CompactionLevel) => {
    // Retry against the same history so the protection window never shifts between attempts.
    const compactedMessages = await smartCompactMessages(messages, options?.protectedMessageCount, level, options?.passes);
    const savings = Math.round((historyTokens - estimateContextMessageTokens(compactedMessages)) * scale);
    return { messages: compactedMessages, level, tokensAfter: target.tokensBefore - savings };
  };

  let best = await compactAt(startingLevel);
  for (let level = startingLevel + 1; best.tokensAfter > target.threshold && level <= CompactionLevel.Max; level++) {
    const candidate = await compactAt(level);
    if (candidate.tokensAfter < best.tokensAfter) {
      best = candidate;
    }
  }
  return best;
};

export const formatSmartCompactionResult = (
  language: string | undefined,
  target: SmartCompactionTokenTarget,
  result: Awaited<ReturnType<typeof smartCompactToTokenTarget>>,
): string => {
  const params = {
    level: String(result.level),
    before: String(target.tokensBefore),
    after: String(result.tokensAfter),
    saved: String(Math.max(0, target.tokensBefore - result.tokensAfter)),
    threshold: String(Math.floor(target.threshold)),
  };
  const summary = translate(language, 'compaction.smartResult', params);
  return result.tokensAfter > target.threshold ? `${summary} ${translate(language, 'compaction.smartTargetMissed', params)}` : summary;
};

export const extractSummary = (content: string): string => {
  const lines = content.split('\n');
  const summaryMarker = '### **Conversation Summary**';
  const markerIndex = lines.findIndex((line) => line.trim() === summaryMarker);
  if (markerIndex !== -1) {
    return lines.slice(markerIndex).join('\n');
  }
  return content;
};

export const getSubagentOldResultIds = (resultMessages: ContextMessage[], userRequestMessageId: string): string[] =>
  resultMessages.filter((m) => m.id !== userRequestMessageId).map((m) => m.id);

export const getReloadableMessages = (messages: ContextMessage[]): ContextMessage[] => messages.filter((m) => m.role !== 'user');

export const buildCompactSummaryMessages = (
  userMessage: ContextMessage,
  summaryContent: string | undefined,
  promptContext?: PromptContext,
): ContextMessage[] => [
  userMessage,
  {
    id: uuidv4(),
    role: 'assistant',
    content: summaryContent ? extractSummary(summaryContent) : 'Failed to generate summary.',
    promptContext,
    timestamp: Date.now(),
  },
];

export const generateCompactedSummary = async (
  userMessage: ContextMessage,
  allMessages: ContextMessage[],
  profile: AgentProfile,
  task: Task,
  promptContext?: PromptContext,
  abortSignal?: AbortSignal,
  getCompactConversationPrompt: (task: Task, customInstructions?: string) => Promise<string> = async () => '',
  generateText: (
    modelId: string,
    systemPrompt: string,
    prompt: string,
    projectDir: string,
    messages: ContextMessage[],
    abortable: boolean,
    abortSignal?: AbortSignal,
    sessionId?: string,
  ) => Promise<string | undefined> = async () => undefined,
): Promise<ContextMessage[]> => {
  const compactPrompt = await getCompactConversationPrompt(task, undefined);
  const summaryText = await generateText(
    `${profile.provider}/${profile.model}`,
    '',
    compactPrompt,
    task.getProjectDir(),
    allMessages,
    true,
    abortSignal,
    task.task.id,
  );
  return buildCompactSummaryMessages(userMessage, summaryText, promptContext);
};
