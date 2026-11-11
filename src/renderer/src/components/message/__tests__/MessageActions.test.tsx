import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { MessageActions } from '../MessageActions';

import { render } from '@/__tests__/render';
import { createMockApi } from '@/__tests__/mocks/api';
import { useApi, useIsReadonlyView } from '@/contexts/ApiContext';
import { showErrorNotification } from '@/utils/notifications';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/contexts/ApiContext', () => ({
  useApi: vi.fn(),
  useIsReadonlyView: vi.fn(() => false),
}));

vi.mock('@/utils/notifications', () => ({ showErrorNotification: vi.fn() }));

vi.mock('@/stores/taskStore', () => ({
  useTaskStore: vi.fn(() => false),
}));

describe('MessageActions', () => {
  const mockApi = createMockApi();

  const defaultProps = {
    actions: [{ id: 'resolve-git-error-with-agent' }],
    baseDir: '/project',
    taskId: 'task-123',
    removeActionId: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApi).mockReturnValue(mockApi);
  });

  it('renders the Resolve with AI button for resolve-git-error-with-agent action', () => {
    render(<MessageActions {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'git.resolveWithAI' })).toBeInTheDocument();
  });

  it('calls resolveGitErrorWithAgent and removeActionId when the button is clicked', () => {
    render(<MessageActions {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'git.resolveWithAI' }));

    expect(mockApi.resolveGitErrorWithAgent).toHaveBeenCalledWith('/project', 'task-123');
    expect(defaultProps.removeActionId).toHaveBeenCalledWith('resolve-git-error-with-agent');
  });

  it('hides the button after execution', () => {
    render(<MessageActions {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'git.resolveWithAI' }));

    expect(screen.queryByRole('button', { name: 'git.resolveWithAI' })).not.toBeInTheDocument();
  });

  it('renders nothing when actions is empty', () => {
    render(<MessageActions {...defaultProps} actions={[]} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not call removeActionId when the prop is not provided', () => {
    const { removeActionId: _omitted, ...propsWithoutRemoveActionId } = defaultProps;
    render(<MessageActions {...propsWithoutRemoveActionId} />);

    fireEvent.click(screen.getByRole('button', { name: 'git.resolveWithAI' }));

    expect(mockApi.resolveGitErrorWithAgent).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, { requestId: 'request-1', nested: [true, null, 1] }])('does not pass the action as an interrupt ID: %j', (data) => {
    const onInterrupt = vi.fn();
    const action = { id: 'interrupt', data };
    render(<MessageActions {...defaultProps} actions={[action]} onInterrupt={onInterrupt} />);

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));

    expect(onInterrupt).toHaveBeenCalledExactlyOnceWith();
  });

  it('cancels the current response without supplying an interrupt ID', () => {
    const onInterrupt = (interruptId?: string) => {
      void mockApi.interruptResponse('/project', 'task-123', interruptId);
    };
    render(<MessageActions {...defaultProps} actions={[{ id: 'interrupt' }]} onInterrupt={onInterrupt} />);

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));

    expect(mockApi.interruptResponse).toHaveBeenCalledExactlyOnceWith('/project', 'task-123', undefined);
  });

  it('preserves existing API behavior when an action includes data', () => {
    render(<MessageActions {...defaultProps} actions={[{ id: 'resolve-git-error-with-agent', data: { reason: 'conflict' } }]} />);

    fireEvent.click(screen.getByRole('button', { name: 'git.resolveWithAI' }));

    expect(mockApi.resolveGitErrorWithAgent).toHaveBeenCalledExactlyOnceWith('/project', 'task-123');
    expect(defaultProps.removeActionId).toHaveBeenCalledExactlyOnceWith('resolve-git-error-with-agent');
  });

  it('ignores unknown actions', () => {
    render(<MessageActions {...defaultProps} actions={[{ id: 'unknown', data: 42 }]} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('compaction restore actions', () => {
  it.each([true, false])('passes the persisted checkpoint without requiring an in-memory snapshot; restore=%s', async (restored) => {
    const api = createMockApi();
    vi.mocked(useApi).mockReturnValue(api);
    vi.mocked(api.undoContextChange).mockResolvedValue(restored);
    const removeActionId = vi.fn();
    render(
      <MessageActions
        baseDir="/project"
        taskId="task-123"
        actions={[{ id: 'undoContextChange', data: { checkpointId: 'context.pre-compaction.002.json' } }]}
        removeActionId={removeActionId}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'common.undo' }));
    await waitFor(() => expect(api.undoContextChange).toHaveBeenCalledWith('/project', 'task-123', 'context.pre-compaction.002.json'));
    if (restored) {
      await waitFor(() => expect(removeActionId).toHaveBeenCalledWith('undoContextChange'));
    } else {
      expect(await screen.findByRole('alert')).toHaveTextContent('common.restoreContextFailed');
      expect(removeActionId).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'common.undo' })).toBeInTheDocument();
    }
  });
});

describe('log split actions', () => {
  const checkpointId = 'context.pre-compaction.002.json';
  const actions = [{ id: 'undoContextChange', data: { checkpointId }, alternativeActions: [{ id: 'forkTaskFromCheckpoint', data: { checkpointId } }] }];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(useIsReadonlyView).mockReturnValue(false);
  });

  it.each([true, false])('forks without undoing or consuming the original action, success=%s', async (success) => {
    const api = createMockApi();
    vi.mocked(useApi).mockReturnValue(api);
    if (!success) {
      vi.mocked(api.forkTaskFromCheckpoint).mockRejectedValueOnce(new Error('Missing checkpoint'));
    }
    const removeActionId = vi.fn();
    render(<MessageActions baseDir="/project" taskId="task-123" actions={actions} removeActionId={removeActionId} />);
    expect(screen.getByRole('button', { name: 'common.undo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'splitButton.moreActions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'common.forkBeforeCompaction' }));
    await waitFor(() => expect(api.forkTaskFromCheckpoint).toHaveBeenCalledWith('/project', 'task-123', checkpointId));
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.undo' })).toBeEnabled());
    expect(api.undoContextChange).not.toHaveBeenCalled();
    expect(removeActionId).not.toHaveBeenCalled();
    if (!success) {
      expect(showErrorNotification).toHaveBeenCalledWith('errors.forkTaskFailed');
    }
  });

  it('keeps Undo as the primary action of the split button', async () => {
    const api = createMockApi();
    vi.mocked(useApi).mockReturnValue(api);
    vi.mocked(api.undoContextChange).mockResolvedValue(true);
    render(<MessageActions baseDir="/project" taskId="task-123" actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.undo' }));
    await waitFor(() => expect(api.undoContextChange).toHaveBeenCalledWith('/project', 'task-123', checkpointId));
    expect(api.forkTaskFromCheckpoint).not.toHaveBeenCalled();
  });

  it('renders ordinary buttons when alternatives are unknown', () => {
    vi.mocked(useApi).mockReturnValue(createMockApi());
    render(<MessageActions baseDir="/project" taskId="task-123" actions={[{ id: 'interrupt', alternativeActions: [{ id: 'unknown' }] }]} />);
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'splitButton.moreActions' })).not.toBeInTheDocument();
  });

  it('hides all actions in readonly views', () => {
    vi.mocked(useApi).mockReturnValue(createMockApi());
    vi.mocked(useIsReadonlyView).mockReturnValue(true);
    render(<MessageActions baseDir="/project" taskId="task-123" actions={actions} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
