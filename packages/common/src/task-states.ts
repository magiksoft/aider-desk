import { DefaultTaskState, TaskStateDefinition } from './types';

export const BUILT_IN_TASK_STATE_DEFINITIONS: TaskStateDefinition[] = [
  { id: DefaultTaskState.Todo, name: 'Todo', color: 'var(--color-text-primary)', priority: 10 },
  { id: DefaultTaskState.ReadyForImplementation, name: 'Ready for Implementation', color: 'var(--color-info-light)', priority: 20 },
  { id: DefaultTaskState.InProgress, name: 'In Progress', color: 'var(--color-button-primary)', priority: 30 },
  { id: DefaultTaskState.Interrupted, name: 'Interrupted', color: 'var(--color-button-danger)', priority: 40 },
  { id: DefaultTaskState.Delegated, name: 'Delegated', color: 'var(--color-warning)', priority: 50 },
  { id: DefaultTaskState.MoreInfoNeeded, name: 'More Info Needed', color: 'var(--color-error)', priority: 60 },
  { id: DefaultTaskState.ReadyForReview, name: 'Ready for Review', color: 'var(--color-success-light)', priority: 70 },
  { id: DefaultTaskState.Done, name: 'Done', color: 'var(--color-text-muted-light)', priority: 80 },
];

export const compareTaskStates = (a: Pick<TaskStateDefinition, 'priority' | 'id'>, b: Pick<TaskStateDefinition, 'priority' | 'id'>): number =>
  a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const isValidTaskStateDefinition = (value: unknown): value is TaskStateDefinition => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const state = value as Partial<TaskStateDefinition>;
  return (
    typeof state.id === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(state.id) &&
    typeof state.name === 'string' &&
    state.name.trim().length > 0 &&
    state.name === state.name.trim() &&
    typeof state.color === 'string' &&
    /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(state.color) &&
    typeof state.priority === 'number' &&
    Number.isFinite(state.priority)
  );
};

export const isManuallySelectableTaskState = (state: Pick<TaskStateDefinition, 'id'>): boolean =>
  state.id !== DefaultTaskState.InProgress && state.id !== DefaultTaskState.Interrupted && state.id !== DefaultTaskState.Delegated;
