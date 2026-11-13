import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_TASK_STATE_DEFINITIONS } from '@common/task-states';
import { DefaultTaskState, ExtensionUIRefreshData, TaskData } from '@common/types';

import { TaskStateChip } from '../TaskStateChip';

import { ExtensionsProvider } from '@/contexts/ExtensionsContext';
import { ApiContext } from '@/contexts/ApiContext';
import { createMockApi } from '@/__tests__/mocks/api';
import { useTaskStatesStore } from '@/stores/taskStatesStore';
import { TaskMenuButton } from '@/components/project/TaskSidebar/TaskMenuButton';

vi.mock('@/utils/extension-library-loader', () => ({ initExtensionLibraryLoader: vi.fn(async () => {}) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => (key === 'taskState.TODO' ? 'Localized Todo' : (options?.defaultValue ?? key)),
  }),
}));

const custom = { id: 'custom', name: 'Waiting for QA', color: '#123456', priority: 25 };
const definitions = [...BUILT_IN_TASK_STATE_DEFINITIONS.slice(0, 2), custom, ...BUILT_IN_TASK_STATE_DEFINITIONS.slice(2)];

beforeEach(() => {
  useTaskStatesStore.setState({ definitions: new Map([['/project', definitions]]), requests: new Map() });
});

describe('task-state rendering', () => {
  it('renders registered names and colors in project scope while retaining localized theme-aware built-ins', () => {
    render(
      <>
        <TaskStateChip state="custom" projectDir="/project" />
        <TaskStateChip state={DefaultTaskState.Todo} />
      </>,
    );
    expect(screen.getByText(custom.name)).toHaveStyle({ color: custom.color });
    expect(screen.getByText('Localized Todo')).toHaveClass('text-text-primary');
    expect(screen.getByText('Localized Todo').style.color).toBe('');
  });

  it('uses safe fallback for unknown, removed, and other-project states', () => {
    const { rerender } = render(<TaskStateChip state="custom" projectDir="/other" />);
    expect(screen.getByText('Custom')).toHaveClass('text-text-primary');
    expect(screen.getByText('Custom').style.color).toBe('');
    rerender(<TaskStateChip state="removed_state-id" projectDir="/project" />);
    expect(screen.getByText('Removed State Id')).toBeInTheDocument();
  });

  it('updates chips when definitions change or disappear', () => {
    render(<TaskStateChip state="custom" projectDir="/project" />);
    act(() => {
      useTaskStatesStore.setState({ definitions: new Map([['/project', [{ ...custom, name: 'Updated name' }]]]) });
    });
    expect(screen.getByText('Updated name')).toBeInTheDocument();
    act(() => {
      useTaskStatesStore.setState({ definitions: new Map() });
    });
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('adds custom states in priority order without offering operational states', () => {
    const onChangeState = vi.fn();
    const task = { baseDir: '/project', state: DefaultTaskState.Todo, createdAt: '2026-01-01' } as TaskData;
    render(<TaskMenuButton task={task} onEdit={vi.fn()} onChangeState={onChangeState} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('taskSidebar.changeState'));
    const items = screen.getByText(custom.name).parentElement!;
    expect([...items.children].map((item) => item.textContent)).toEqual([
      'Localized Todo',
      'Ready For Implementation',
      custom.name,
      'More Info Needed',
      'Ready For Review',
      'Done',
    ]);
    fireEvent.click(screen.getByText(custom.name));
    expect(onChangeState).toHaveBeenCalledWith('custom');
  });

  it('does not expose Change state for a running task or unsaved task', () => {
    const { rerender } = render(
      <TaskMenuButton task={{ baseDir: '/project', state: DefaultTaskState.InProgress, createdAt: '2026-01-01' } as TaskData} onEdit={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('taskSidebar.changeState')).not.toBeInTheDocument();
    rerender(<TaskMenuButton task={{ baseDir: '/project', state: DefaultTaskState.Todo } as TaskData} onEdit={vi.fn()} />);
    expect(screen.queryByText('taskSidebar.changeState')).not.toBeInTheDocument();
  });
});

describe('task-state refresh integration', () => {
  it('loads on mount, refreshes matching project/global events, ignores other projects, and unsubscribes', async () => {
    const api = createMockApi();
    let refresh: (event: ExtensionUIRefreshData) => void = () => {};
    const unsubscribe = vi.fn();
    vi.mocked(api.onExtensionUIRefresh).mockImplementation((listener) => {
      refresh = listener;
      return unsubscribe;
    });
    vi.mocked(api.getTaskStateDefinitions).mockResolvedValue(definitions);
    const { unmount } = render(
      <ApiContext.Provider value={api}>
        <ExtensionsProvider projectDir="/project">
          <ExtensionsProvider projectDir="/project">
            <TaskStateChip state="custom" />
          </ExtensionsProvider>
        </ExtensionsProvider>
      </ApiContext.Provider>,
    );
    await waitFor(() => expect(api.getTaskStateDefinitions).toHaveBeenCalledWith('/project'));
    await act(async () => {
      refresh({ projectDir: '/other', reloadTaskStates: true });
      refresh({ reloadComponents: true });
    });
    expect(api.getTaskStateDefinitions).toHaveBeenCalledTimes(1);
    vi.mocked(api.getTaskStateDefinitions).mockResolvedValue(BUILT_IN_TASK_STATE_DEFINITIONS);
    await act(async () => {
      refresh({ projectDir: '/project', reloadTaskStates: true });
    });
    expect(screen.getByText('Custom')).toBeInTheDocument();
    await act(async () => {
      refresh({ reloadTaskStates: true });
    });
    expect(api.getTaskStateDefinitions).toHaveBeenCalledTimes(3);
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
