import { DEFAULT_TASK_STATES } from '@common/types';

export interface TaskStateFilterPreferences {
  knownIds: string[];
  selectedIds: string[];
}

export const getSelectedTaskStates = (preferences: TaskStateFilterPreferences | null | undefined, stateIds: ReadonlySet<string>): Set<string> => {
  const known = new Set(preferences?.knownIds ?? DEFAULT_TASK_STATES);
  return new Set([...(preferences?.selectedIds ?? stateIds), ...[...stateIds].filter((id) => !known.has(id))]);
};

export const mergeTaskStateFilterPreferences = (
  preferences: TaskStateFilterPreferences | null | undefined,
  stateIds: ReadonlySet<string>,
): TaskStateFilterPreferences => {
  if (preferences && [...stateIds].every((id) => preferences.knownIds.includes(id))) {
    return preferences;
  }
  return {
    knownIds: [...new Set([...(preferences?.knownIds ?? DEFAULT_TASK_STATES), ...stateIds])],
    selectedIds: [...getSelectedTaskStates(preferences, stateIds)],
  };
};
