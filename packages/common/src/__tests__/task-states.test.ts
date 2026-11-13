import { describe, expect, it } from 'vitest';

import { BUILT_IN_TASK_STATE_DEFINITIONS, isManuallySelectableTaskState, isValidTaskStateDefinition } from '../task-states';
import { DefaultTaskState } from '../types';

const valid = { id: 'custom-status_1', name: 'Custom status', color: '#ab12ef', priority: 25 };

describe('task-state validation', () => {
  it.each(['#abc', '#abcd', '#a1b2c3', '#a1b2c3d4', '#ABCDEF'])('accepts safe hex color %s', (color) => {
    expect(isValidTaskStateDefinition({ ...valid, color, priority: -0.5 })).toBe(true);
  });

  it.each([
    null,
    undefined,
    false,
    [],
    {},
    { ...valid, id: '' },
    { ...valid, id: ' has spaces ' },
    { ...valid, id: 'a.b' },
    { ...valid, name: '' },
    { ...valid, name: ' ' },
    { ...valid, name: ' padded ' },
    { ...valid, color: 'red' },
    { ...valid, color: 'var(--color-text-primary)' },
    { ...valid, color: '#ab' },
    { ...valid, color: 'url(https://example.com)' },
    { ...valid, priority: NaN },
    { ...valid, priority: Infinity },
    { ...valid, priority: '10' },
  ])('rejects invalid input %#', (input) => {
    expect(isValidTaskStateDefinition(input)).toBe(false);
  });

  it('preserves operational-state restrictions without restricting custom states', () => {
    expect(BUILT_IN_TASK_STATE_DEFINITIONS.filter(isManuallySelectableTaskState).map((state) => state.id)).toEqual([
      DefaultTaskState.Todo,
      DefaultTaskState.ReadyForImplementation,
      DefaultTaskState.MoreInfoNeeded,
      DefaultTaskState.ReadyForReview,
      DefaultTaskState.Done,
    ]);
    expect(isManuallySelectableTaskState(valid)).toBe(true);
  });
});
