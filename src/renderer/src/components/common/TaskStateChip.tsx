import { useTranslation } from 'react-i18next';
import { twMerge } from 'tailwind-merge';
import { DEFAULT_TASK_STATES, TaskStateDefinition, DefaultTaskState } from '@common/types';

import type { TFunction } from 'i18next';

import { useTaskStates } from '@/contexts/ExtensionsContext';

export const getStateTextClass = (state: string): string => {
  switch (state) {
    case DefaultTaskState.Interrupted:
      return 'text-button-danger';
    case DefaultTaskState.Delegated:
      return 'text-warning';
    case DefaultTaskState.Todo:
      return 'text-text-primary';
    case DefaultTaskState.Done:
      return 'text-text-muted-light';
    case DefaultTaskState.MoreInfoNeeded:
      return 'text-error';
    case DefaultTaskState.ReadyForReview:
      return 'text-success-light';
    case DefaultTaskState.ReadyForImplementation:
      return 'text-info-light';
    case DefaultTaskState.InProgress:
      return 'text-button-primary';
    default:
      return 'text-text-primary';
  }
};

export const getTaskStateLabel = (t: TFunction, state: string, definitions: TaskStateDefinition[] = []) => {
  if (!DEFAULT_TASK_STATES.has(state)) {
    const definition = definitions.find((definition) => definition.id === state);
    if (definition) {
      return definition.name;
    }
  }
  return t(`taskState.${state}`, {
    defaultValue: state
      .replace(/[-_]/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase()),
  });
};

type Props = {
  state: string;
  className?: string;
  projectDir?: string;
};

export const TaskStateChip = ({ state, className = '', projectDir }: Props) => {
  const { t } = useTranslation();

  const definitions = useTaskStates(projectDir);
  const color = definitions.find((definition) => definition.id === state)?.color;
  const stateTextClass = getStateTextClass(state);

  return (
    <span
      style={DEFAULT_TASK_STATES.has(state) ? undefined : { color }}
      className={twMerge('text-4xs px-1 rounded border border-border-dark-light bg-bg-tertiary-emphasis whitespace-nowrap', stateTextClass, className)}
    >
      {getTaskStateLabel(t, state, definitions)}
    </span>
  );
};
