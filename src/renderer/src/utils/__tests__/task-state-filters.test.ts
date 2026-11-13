import { describe, expect, it } from 'vitest';
import { DEFAULT_TASK_STATES, DefaultTaskState, TaskData } from '@common/types';

import { getSelectedTaskStates, mergeTaskStateFilterPreferences } from '../task-state-filters';
import { flattenTasksForVirtualization, getSortedVisibleTasks } from '../task-utils';

const states = new Set([...DEFAULT_TASK_STATES, 'custom']);

describe('task-state filters', () => {
  it('migrates legacy choices without hiding newly registered states', () => {
    const legacy = { knownIds: [...DEFAULT_TASK_STATES], selectedIds: [DefaultTaskState.Todo] };
    const selected = getSelectedTaskStates(legacy, states);
    expect([...selected]).toEqual([DefaultTaskState.Todo, 'custom']);
    const persisted = mergeTaskStateFilterPreferences(legacy, states);
    expect(persisted.selectedIds).toEqual([...selected]);
    expect(persisted.knownIds).toContain('custom');
    expect(mergeTaskStateFilterPreferences(persisted, states)).toBe(persisted);
  });

  it('preserves a deselected state across removal and re-registration, while showing other new states', () => {
    const preferences = { knownIds: [...states], selectedIds: [DefaultTaskState.Done] };
    const removed = mergeTaskStateFilterPreferences(preferences, DEFAULT_TASK_STATES);
    expect(removed).toBe(preferences);
    expect(getSelectedTaskStates(removed, states).has('custom')).toBe(false);
    expect(getSelectedTaskStates(removed, new Set([...states, 'new'])).has('new')).toBe(true);
  });

  it('defaults all states to visible when preferences are absent', () => {
    expect(getSelectedTaskStates(undefined, states)).toEqual(states);
  });

  it('filters registered states but preserves unknown and removed IDs without modifying tasks', () => {
    const tasks = [
      { id: 'custom', name: 'Custom', state: 'custom' },
      { id: 'unknown', name: 'Unknown', state: 'removed-state' },
      { id: 'todo', name: 'Todo', state: DefaultTaskState.Todo },
    ] as TaskData[];
    const selected = new Set([DefaultTaskState.Todo]);
    expect(getSortedVisibleTasks(tasks, selected, false, '', states).map((task) => task.id)).toEqual(['unknown', 'todo']);
    expect(getSortedVisibleTasks(tasks, selected, false, '', DEFAULT_TASK_STATES).map((task) => task.id)).toEqual(['custom', 'unknown', 'todo']);
    expect(
      flattenTasksForVirtualization(tasks, new Set(), selected, false, '', states)
        .filter((item) => item.type === 'task')
        .map((item) => item.id),
    ).toEqual(['unknown', 'todo']);
    expect(tasks[0].state).toBe('custom');
  });
});
