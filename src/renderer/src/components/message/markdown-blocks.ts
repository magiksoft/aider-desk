export const LIST_ITEM_REGEX = /^\s{0,3}(?:[-*+]|\d{1,9}[.)]?)(?:\s|$)/;
const ORDERED_LIST_ITEM_REGEX = /^\s*\d+\.\s/;
export const BLOCKQUOTE_REGEX = /^\s{0,3}>/;
const FENCE_OPEN_REGEX = /^\s{0,3}(`{3,}|~{3,})/;
const INDENTED_LINE_REGEX = /^\s+\S/;
export const LINK_REFERENCE_DEFINITION_REGEX = /^\s*\[[^\]]+\]:\s+/m;
export const FOOTNOTE_REGEX = /\[\^[^\]]+\]/;
const MATH_DELIMITER_REGEX = /\$\$/g;

enum LineType {
  List = 'list',
  Quote = 'quote',
  Other = 'other',
}

type FenceState = { char: string; length: number };

/**
 * Inserts a blank line before an ordered list item that directly follows a
 * non-list line, so the item is parsed as a list instead of paragraph text.
 */
export const normalizeListBlocks = (text: string): string => {
  const lines = text.split('\n');
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ORDERED_LIST_ITEM_REGEX.test(line) && result.length > 0) {
      const prev = result[result.length - 1];
      if (prev.trim() && !ORDERED_LIST_ITEM_REGEX.test(prev)) {
        result.push('');
      }
    }
    result.push(line);
  }
  return result.join('\n');
};

/**
 * Splits a Markdown prose string into independent top-level blocks at safe
 * boundaries so each block can be rendered and memoized separately while
 * streaming. Blocks are only separated at blank lines outside fenced code
 * and $$ math blocks; loose lists, blockquote runs and GFM tables stay
 * intact within a single block.
 *
 * The split is prefix-stable: when text grows by appends, all settled
 * blocks before the trailing block remain byte-identical strings.
 */
export const splitMarkdownBlocks = (text: string): string[] => {
  if (!text.trim()) {
    return [];
  }

  // Link reference definitions and footnotes may be defined in one block and
  // referenced in another, so the whole text must be parsed together.
  if (LINK_REFERENCE_DEFINITION_REGEX.test(text) || FOOTNOTE_REGEX.test(text)) {
    return [normalizeListBlocks(text)];
  }

  const blocks: string[] = [];
  let current: string[] = [];
  let pendingBlankLines: string[] = [];
  let fence: FenceState | null = null;
  let inMathBlock = false;
  let lastLineType: LineType = LineType.Other;

  const flushCurrentBlock = () => {
    if (current.length > 0) {
      blocks.push(current.join('\n'));
      current = [];
    }
    pendingBlankLines = [];
  };

  for (const line of text.split('\n')) {
    if (fence) {
      current.push(...pendingBlankLines, line);
      pendingBlankLines = [];
      if (isFenceClose(line, fence)) {
        fence = null;
      }
      continue;
    }

    if (inMathBlock) {
      current.push(...pendingBlankLines, line);
      pendingBlankLines = [];
      if (countMathDelimiters(line) % 2 === 1) {
        inMathBlock = false;
      }
      continue;
    }

    if (!line.trim()) {
      pendingBlankLines.push(line);
      continue;
    }

    const isListCandidate = LIST_ITEM_REGEX.test(line);
    const isBlockquote = BLOCKQUOTE_REGEX.test(line);
    const isIndented = INDENTED_LINE_REGEX.test(line);

    if (current.length > 0) {
      const continuesList = lastLineType === LineType.List && (isListCandidate || isIndented);
      const continuesQuote = lastLineType === LineType.Quote && isBlockquote;
      if (pendingBlankLines.length > 0 && !continuesList && !continuesQuote) {
        flushCurrentBlock();
      } else {
        current.push(...pendingBlankLines);
      }
    }
    pendingBlankLines = [];

    current.push(line);

    const fenceMatch = line.match(FENCE_OPEN_REGEX);
    if (fenceMatch) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
    } else if (countMathDelimiters(line) % 2 === 1) {
      inMathBlock = true;
    }

    if (isBlockquote) {
      lastLineType = LineType.Quote;
    } else if (isListCandidate) {
      lastLineType = LineType.List;
    } else if (!isIndented) {
      lastLineType = LineType.Other;
    }
  }

  flushCurrentBlock();

  return blocks.map(normalizeListBlocks);
};

const isFenceClose = (line: string, fence: FenceState): boolean => {
  const trimmed = line.trim();
  let count = 0;
  while (count < trimmed.length && trimmed[count] === fence.char) {
    count += 1;
  }
  return count >= fence.length && count === trimmed.length;
};

const countMathDelimiters = (line: string): number => {
  return line.match(MATH_DELIMITER_REGEX)?.length ?? 0;
};
