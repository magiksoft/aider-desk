import { ReactNode } from 'react';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { BUILT_IN_TASK_STATE_DEFINITIONS } from '@common/task-states';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultTaskState, TaskData } from '@common/types';

import { TaskSidebar } from '../TaskSidebar';

import { useTaskStatesStore } from '@/stores/taskStatesStore';
import { render } from '@/__tests__/render';
import { useTask } from '@/contexts/TasksContext';
import { useOptimizedTaskState, EMPTY_TASK_STATE } from '@/stores/taskStore';
import { createMockTaskContext } from '@/__tests__/mocks/contexts';

// Mock @tanstack/react-virtual
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 28,
        size: 28,
        key: i,
      })),
    getTotalSize: () => count * 28,
    scrollToOffset: vi.fn(),
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
    isScrolling: false,
  })),
}));

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock useTask context
vi.mock('@/contexts/TasksContext', () => ({
  useTask: vi.fn(),
}));

// Mock useExtensions hook
vi.mock('@/contexts/ExtensionsContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/ExtensionsContext')>()),
  useExtensions: vi.fn(() => ({
    componentProps: {
      projectDir: '/test/project',
      task: null,
      agentProfile: null,
    },
  })),
}));

// Mock ExtensionComponentWrapper to avoid API context requirement
vi.mock('@/components/extensions/ExtensionComponentWrapper', () => ({
  ExtensionComponentWrapper: () => null,
}));

// Mock useTaskState from taskStore
vi.mock('@/stores/taskStore', () => ({
  useOptimizedTaskState: vi.fn(() => EMPTY_TASK_STATE),
  useTaskState: vi.fn(),
  useTaskQuestion: vi.fn(() => null),
  EMPTY_TASK_STATE: {
    loading: false,
    loaded: false,
    tokensInfo: null,
    question: null,
    todoItems: [],
    aiderTotalCost: 0,
    contextFiles: [],
    aiderModelsData: null,
  },
}));

interface IconButtonProps {
  onClick?: () => void;
  icon: ReactNode;
  tooltip?: string;
}

// Mock IconButton and other components if needed
vi.mock('@/components/common/IconButton', () => ({
  IconButton: ({ onClick, icon, tooltip }: IconButtonProps) => (
    <button onClick={onClick} title={tooltip}>
      {icon}
    </button>
  ),
}));

describe('TaskSidebar', () => {
  const mockTasks = [
    { id: 'task-1', name: 'Task 1', createdAt: '2023-01-01T00:00:00Z', updatedAt: '2023-01-01T00:00:00Z' },
    { id: 'task-2', name: 'Task 2', createdAt: '2023-01-02T00:00:00Z', updatedAt: '2023-01-02T00:00:00Z' },
  ] as TaskData[];

  beforeEach(() => {
    useTaskStatesStore.setState({ definitions: new Map(), requests: new Map() });
    localStorage.clear();
    vi.mocked(useTask).mockReturnValue(createMockTaskContext());
    vi.mocked(useOptimizedTaskState).mockReturnValue(EMPTY_TASK_STATE);
  });

  it('renders a list of tasks', () => {
    render(
      <TaskSidebar
        projectDir="/test/project"
        showArchived={false}
        onShowArchivedChange={vi.fn()}
        loading={false}
        tasks={mockTasks}
        activeTaskId="task-1"
        onTaskSelect={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );

    expect(screen.getByText('Task 1')).toBeInTheDocument();
    expect(screen.getByText('Task 2')).toBeInTheDocument();
  });

  it('persists selected state filters across remounts without affecting other projects', () => {
    const tasks = [
      { id: 'todo', name: 'Todo task', state: DefaultTaskState.Todo },
      { id: 'done', name: 'Done task', state: DefaultTaskState.Done },
    ] as TaskData[];
    const props = {
      tasks,
      loading: false,
      activeTaskId: null,
      onTaskSelect: vi.fn(),
      isCollapsed: false,
      onToggleCollapse: vi.fn(),
      showArchived: false,
      onShowArchivedChange: vi.fn(),
    };
    const view = render(<TaskSidebar {...props} projectDir="/project-a" />);
    fireEvent.click(screen.getByRole('button', { name: 'taskSidebar.filterStates' }));
    fireEvent.click(screen.getByRole('checkbox', { name: `taskState.${DefaultTaskState.Todo}` }));

    expect(screen.queryByText('Todo task')).not.toBeInTheDocument();
    expect(screen.getByText('Done task')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('task-sidebar-state-filters-/project-a')!).selectedIds).not.toContain(DefaultTaskState.Todo);
    view.unmount();

    const restored = render(<TaskSidebar {...props} projectDir="/project-a" />);
    expect(screen.queryByText('Todo task')).not.toBeInTheDocument();
    expect(screen.getByText('Done task')).toBeInTheDocument();
    restored.unmount();

    render(<TaskSidebar {...props} projectDir="/project-b" />);
    expect(screen.getByText('Todo task')).toBeInTheDocument();
    expect(screen.getByText('Done task')).toBeInTheDocument();
  });

  it('defaults new states to visible, orders filters by priority, and remembers exclusions after removal and remount', () => {
    localStorage.setItem('task-sidebar-selected-states-/test/project', '[]');
    const custom = { id: 'custom', name: 'Waiting for QA', color: '#123456', priority: 25 };
    const definitions = [...BUILT_IN_TASK_STATE_DEFINITIONS.slice(0, 2), custom, ...BUILT_IN_TASK_STATE_DEFINITIONS.slice(2)];
    useTaskStatesStore.setState({ definitions: new Map([['/test/project', definitions]]) });
    const props = {
      projectDir: '/test/project',
      showArchived: false,
      onShowArchivedChange: vi.fn(),
      loading: false,
      tasks: [
        { id: 'todo', name: 'Todo task', state: DefaultTaskState.Todo },
        { id: 'custom', name: 'QA task', state: 'custom' },
      ] as TaskData[],
      activeTaskId: null,
      onTaskSelect: vi.fn(),
      isCollapsed: false,
      onToggleCollapse: vi.fn(),
    };
    const view = render(<TaskSidebar {...props} />);
    expect(screen.queryByText('Todo task')).not.toBeInTheDocument();
    expect(screen.getByText('QA task')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'taskSidebar.filterStates' }));
    expect(
      screen
        .getAllByRole('checkbox')
        .map((checkbox) => checkbox.getAttribute('aria-label'))
        .slice(0, 4),
    ).toEqual(['taskState.TODO', 'taskState.READY_FOR_IMPLEMENTATION', custom.name, 'taskState.IN_PROGRESS']);
    fireEvent.click(screen.getByRole('checkbox', { name: custom.name }));
    expect(screen.queryByText('QA task')).not.toBeInTheDocument();
    act(() => {
      useTaskStatesStore.setState({ definitions: new Map([['/test/project', BUILT_IN_TASK_STATE_DEFINITIONS]]) });
    });
    expect(screen.getByText('QA task')).toBeInTheDocument();
    view.unmount();
    act(() => {
      useTaskStatesStore.setState({ definitions: new Map([['/test/project', definitions]]) });
    });
    render(<TaskSidebar {...props} />);
    expect(screen.queryByText('QA task')).not.toBeInTheDocument();
    expect(screen.queryByText('Todo task')).not.toBeInTheDocument();
  });

  it('preserves an explicitly empty state selection', () => {
    localStorage.setItem('task-sidebar-selected-states-/test/project', '[]');
    const tasks = [{ id: 'todo', name: 'Todo task', state: DefaultTaskState.Todo }] as TaskData[];
    render(
      <TaskSidebar
        projectDir="/test/project"
        showArchived={false}
        onShowArchivedChange={vi.fn()}
        loading={false}
        tasks={tasks}
        activeTaskId={null}
        onTaskSelect={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );

    expect(screen.queryByText('Todo task')).not.toBeInTheDocument();
    expect(localStorage.getItem('task-sidebar-selected-states-/test/project')).toBe('[]');
  });

  it('calls onTaskSelect when a task is clicked', () => {
    const onTaskSelect = vi.fn();
    render(
      <TaskSidebar
        projectDir="/test/project"
        showArchived={false}
        onShowArchivedChange={vi.fn()}
        loading={false}
        tasks={mockTasks}
        activeTaskId="task-1"
        onTaskSelect={onTaskSelect}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Task 2'));
    expect(onTaskSelect).toHaveBeenCalledWith('task-2');
  });

  it('calls createNewTask when plus button is clicked', () => {
    const createNewTask = vi.fn();
    render(
      <TaskSidebar
        projectDir="/test/project"
        showArchived={false}
        onShowArchivedChange={vi.fn()}
        loading={false}
        tasks={mockTasks}
        activeTaskId="task-1"
        onTaskSelect={vi.fn()}
        createNewTask={createNewTask}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('create-task-button'));
    expect(createNewTask).toHaveBeenCalled();
  });

  it('uses read-only single selection and hides task creation controls', () => {
    const onTaskSelect = vi.fn();
    render(
      <TaskSidebar
        projectDir="/test/project"
        showArchived={false}
        onShowArchivedChange={vi.fn()}
        loading={false}
        tasks={mockTasks}
        readonly={true}
        activeTaskId="task-1"
        onTaskSelect={onTaskSelect}
        createNewTask={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('create-task-button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Task 2'), { ctrlKey: true });
    expect(onTaskSelect).toHaveBeenCalledWith('task-2');
  });

  it('filters tasks based on search query', async () => {
    render(
      <TaskSidebar
        projectDir="/test/project"
        showArchived={false}
        onShowArchivedChange={vi.fn()}
        loading={false}
        tasks={mockTasks}
        activeTaskId="task-1"
        onTaskSelect={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('search-toggle-button'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('taskSidebar.searchPlaceholder')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('taskSidebar.searchPlaceholder'), {
      target: { value: 'Task 1' },
    });

    await waitFor(() => {
      expect(screen.getByText('Task 1')).toBeInTheDocument();
      expect(screen.queryByText('Task 2')).not.toBeInTheDocument();
    });
  });

  it('sorts tasks by updatedAt descending', () => {
    const tasks = [
      { id: 'task-1', name: 'Task 1', updatedAt: '2023-01-01T00:00:00Z' },
      { id: 'task-2', name: 'Task 2', updatedAt: '2023-01-02T00:00:00Z' },
    ] as TaskData[];

    const { container } = render(
      <TaskSidebar
        projectDir="/test/project"
        showArchived={false}
        onShowArchivedChange={vi.fn()}
        loading={false}
        tasks={tasks}
        activeTaskId="task-2"
        onTaskSelect={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );

    const taskItems = container.querySelectorAll('[data-task-id]');
    expect(taskItems[0]).toHaveAttribute('data-task-id', 'task-2');
    expect(taskItems[1]).toHaveAttribute('data-task-id', 'task-1');
  });

  it('hides archived tasks by default', () => {
    const tasks = [
      { id: 'task-1', name: 'Task 1', archived: false },
      { id: 'task-2', name: 'Task 2', archived: true },
    ] as TaskData[];

    render(
      <TaskSidebar
        projectDir="/test/project"
        showArchived={false}
        onShowArchivedChange={vi.fn()}
        loading={false}
        tasks={tasks}
        activeTaskId="task-1"
        onTaskSelect={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );

    expect(screen.getByText('Task 1')).toBeInTheDocument();
    expect(screen.queryByText('Task 2')).not.toBeInTheDocument();
  });
});
