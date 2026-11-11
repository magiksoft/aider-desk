import { useTranslation } from 'react-i18next';
import { ComponentProps, ReactNode, useState } from 'react';
import { MdCallSplit, MdUndo } from 'react-icons/md';
import { LogAction } from '@common/types';

import { Button } from '../common/Button';
import { SplitButton, SplitButtonAction } from '../common/SplitButton';

import { useApi, useIsReadonlyView } from '@/contexts/ApiContext';
import { useTaskStore } from '@/stores/taskStore';
import { showErrorNotification } from '@/utils/notifications';

type Props = {
  actions: LogAction[];
  baseDir: string;
  taskId: string;
  onInterrupt?: () => void;
  removeActionId?: (actionId: string) => void;
};

export const MessageActions = ({ actions, baseDir, taskId, onInterrupt, removeActionId }: Props) => {
  const { t } = useTranslation();
  const [isExecuted, setIsExecuted] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [isForking, setIsForking] = useState(false);
  const api = useApi();
  const isReadonlyView = useIsReadonlyView();
  const canUndoContextChange = useTaskStore((state) => state.taskStateMap.get(taskId)?.canUndoContextChange ?? false);
  const isLoading = useTaskStore((state) => state.taskStateMap.get(taskId)?.loading ?? false);

  if (isReadonlyView || !actions || actions.length === 0 || isExecuted) {
    return null;
  }

  const handleAbortRebase = () => {
    setIsExecuted(true);
    removeActionId?.('abort-rebase');
    void api.abortRebase(baseDir, taskId);
  };

  const handleContinueRebase = () => {
    setIsExecuted(true);
    removeActionId?.('continue-rebase');
    void api.continueRebase(baseDir, taskId);
  };

  const handleResolveConflictsWithAgent = () => {
    setIsExecuted(true);
    removeActionId?.('resolve-conflicts-with-agent');
    void api.resolveConflictsWithAgent(baseDir, taskId);
  };

  const handleResolveGitErrorWithAgent = () => {
    setIsExecuted(true);
    removeActionId?.('resolve-git-error-with-agent');
    void api.resolveGitErrorWithAgent(baseDir, taskId);
  };

  const handleRebaseWorktree = () => {
    setIsExecuted(true);
    removeActionId?.('rebase-worktree');
    void api.rebaseWorktreeFromBranch(baseDir, taskId);
  };

  const handleUndoContextChange = async ({ data }: LogAction) => {
    const checkpointId = data && typeof data === 'object' && !Array.isArray(data) && typeof data.checkpointId === 'string' ? data.checkpointId : undefined;
    setRestoreFailed(false);
    setIsExecuted(true);
    try {
      const restored = await api.undoContextChange(baseDir, taskId, checkpointId);
      if (restored) {
        removeActionId?.('undoContextChange');
      } else {
        setRestoreFailed(true);
        setIsExecuted(false);
      }
    } catch {
      setRestoreFailed(true);
      setIsExecuted(false);
    }
  };

  const handleForkFromCheckpoint = async ({ data }: LogAction) => {
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.checkpointId !== 'string') {
      return;
    }
    setIsForking(true);
    try {
      await api.forkTaskFromCheckpoint(baseDir, taskId, data.checkpointId);
    } catch {
      showErrorNotification(t('errors.forkTaskFailed'));
    } finally {
      setIsForking(false);
    }
  };

  const handlers: Record<string, (action: LogAction) => void> = {
    interrupt: () => onInterrupt?.(),
    'abort-rebase': handleAbortRebase,
    'continue-rebase': handleContinueRebase,
    'resolve-conflicts-with-agent': handleResolveConflictsWithAgent,
    'resolve-git-error-with-agent': handleResolveGitErrorWithAgent,
    'rebase-worktree': handleRebaseWorktree,
    undoContextChange: handleUndoContextChange,
    forkTaskFromCheckpoint: handleForkFromCheckpoint,
  };

  const actionProps: Record<string, Omit<ComponentProps<typeof Button>, 'children'> & { label: ReactNode; icon?: ReactNode }> = {
    interrupt: { label: t('common.cancel'), variant: 'outline', color: 'danger' },
    'abort-rebase': { label: t('worktree.abortRebase'), variant: 'outline', color: 'danger' },
    'continue-rebase': { label: t('worktree.continueRebase'), variant: 'contained', color: 'primary' },
    'resolve-conflicts-with-agent': { label: t('worktree.resolveConflictsWithAgent'), variant: 'contained', color: 'primary' },
    'resolve-git-error-with-agent': { label: t('git.resolveWithAI'), variant: 'contained', color: 'primary' },
    'rebase-worktree': { label: t('worktree.rebaseFromBranch'), variant: 'contained', color: 'primary' },
    undoContextChange: {
      label: t('common.undo'),
      variant: 'text',
      color: 'primary',
      tooltip: t('promptField.undoContextChange'),
      icon: <MdUndo className="w-4 h-4" />,
      disabled: isLoading,
    },
    forkTaskFromCheckpoint: {
      label: t('common.forkBeforeCompaction'),
      variant: 'text',
      color: 'primary',
      icon: <MdCallSplit className="w-4 h-4" />,
    },
  };

  const getActionProps = (action: LogAction) => {
    if (
      action.id === 'undoContextChange' &&
      !canUndoContextChange &&
      !(action.data && typeof action.data === 'object' && !Array.isArray(action.data) && typeof action.data.checkpointId === 'string')
    ) {
      return undefined;
    }
    return actionProps[action.id];
  };

  const renderAction = (action: LogAction) => {
    const props = getActionProps(action);
    if (!props) {
      return null;
    }
    const { label, icon, ...buttonProps } = props;
    const handleClick = () => handlers[action.id]?.(action);
    const alternativeActions: SplitButtonAction[] = (action.alternativeActions ?? []).flatMap((alternative) => {
      const alternativeProps = getActionProps(alternative);
      return alternativeProps
        ? [
            {
              id: alternative.id,
              label: alternativeProps.label,
              icon: alternativeProps.icon,
              disabled: alternativeProps.disabled,
              onClick: () => handlers[alternative.id]?.(alternative),
            },
          ]
        : [];
    });
    const children = (
      <>
        {icon && <span className="mr-1">{icon}</span>}
        {label}
      </>
    );
    const sharedProps = { ...buttonProps, size: 'xs' as const, disabled: buttonProps.disabled || isForking, onClick: handleClick };
    return alternativeActions.length > 0 ? (
      <SplitButton key={action.id} {...sharedProps} actions={alternativeActions}>
        {children}
      </SplitButton>
    ) : (
      <Button key={action.id} {...sharedProps}>
        {children}
      </Button>
    );
  };

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(renderAction)}
      {restoreFailed && (
        <span role="alert" className="text-text-muted">
          {t('common.restoreContextFailed')}
        </span>
      )}
    </div>
  );
};
