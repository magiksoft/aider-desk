import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactNode } from 'react';
import { TaskData, TaskStateData } from '@common/types';

import { ReadonlyProjectView } from '../ReadonlyProjectView';

import type { ReadonlyBrowserApi, ReadonlyEvent } from '@/api/readonly-browser-api';

import { useReadonlyApi } from '@/contexts/ReadonlyApiContext';

vi.mock('@/contexts/ReadonlyApiContext', () => ({ useReadonlyApi: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useResponsive', () => ({ useResponsive: () => ({ isMobile: false }) }));
vi.mock('@/contexts/ExtensionsContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/ExtensionsContext')>()),
  ExtensionsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/readonly/ReadonlyTaskSidebar', () => ({
  ReadonlyTaskSidebar: ({
    tasks,
    showArchived,
    onShowArchivedChange,
  }: {
    tasks: TaskData[];
    showArchived: boolean;
    onShowArchivedChange: (show: boolean) => void;
  }) => (
    <div>
      <button data-testid="archive-toggle" onClick={() => onShowArchivedChange(!showArchived)}>
        Toggle archives
      </button>
      {tasks.map((task) => (
        <span key={task.id} data-testid={`task-${task.id}`}>
          {task.name}
        </span>
      ))}
    </div>
  ),
}));
vi.mock('@/components/readonly/ReadonlyTaskView', () => ({
  ReadonlyTaskView: ({ task }: { task: TaskData }) => <div data-testid="selected-task">{task.name}</div>,
}));

const active = { id: 'active', name: 'Active', baseDir: '/project' } as TaskData;
const archived = { id: 'archived', name: 'Archived', baseDir: '/project', archived: true } as TaskData;
const state: TaskStateData = { messages: [], files: [], todoItems: [], queuedPrompts: [], question: null, workingMode: 'local' };

describe('ReadonlyProjectView archive loading', () => {
  const api = {
    getTasks: vi.fn<(includeArchived?: boolean) => Promise<TaskData[]>>(),
    loadTask: vi.fn<(taskId: string) => Promise<TaskStateData>>(),
    onEvent: vi.fn<(listener: (event: ReadonlyEvent) => void) => () => void>(),
    onReconnect: vi.fn<(listener: () => void) => () => void>(),
  };
  const onSelectTask = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    api.getTasks.mockResolvedValue([active]);
    api.loadTask.mockResolvedValue(state);
    api.onEvent.mockReturnValue(vi.fn());
    api.onReconnect.mockReturnValue(vi.fn());
    vi.mocked(useReadonlyApi).mockReturnValue(api as unknown as ReadonlyBrowserApi);
  });

  it('excludes archives initially and loads them when the filter is enabled', async () => {
    render(<ReadonlyProjectView projectDir="/project" selectedTaskId="active" onSelectTask={onSelectTask} />);
    await waitFor(() => expect(api.getTasks).toHaveBeenCalledWith(false));
    expect(api.getTasks).not.toHaveBeenCalledWith(true);

    api.getTasks.mockResolvedValue([active, archived]);
    fireEvent.click(screen.getByTestId('archive-toggle'));

    await waitFor(() => expect(screen.getByTestId('task-archived')).toBeInTheDocument());
    expect(api.getTasks).toHaveBeenCalledWith(true);
  });

  it('opens archived deep links by enabling the archive filter', async () => {
    api.getTasks.mockImplementation(async (includeArchived) => (includeArchived ? [active, archived] : [active]));
    render(<ReadonlyProjectView projectDir="/project" selectedTaskId="archived" onSelectTask={onSelectTask} />);

    await waitFor(() => expect(screen.getByTestId('selected-task')).toHaveTextContent('Archived'));
    expect(localStorage.getItem('task-sidebar-show-archived-/project')).toBe('true');
  });

  it('keeps the selected archived task open when the filter is disabled', async () => {
    api.getTasks.mockImplementation(async (includeArchived) => (includeArchived ? [active, archived] : [active]));
    render(<ReadonlyProjectView projectDir="/project" selectedTaskId="archived" onSelectTask={onSelectTask} />);
    await waitFor(() => expect(screen.getByTestId('selected-task')).toHaveTextContent('Archived'));

    fireEvent.click(screen.getByTestId('archive-toggle'));

    await waitFor(() => expect(api.getTasks).toHaveBeenLastCalledWith(false));
    expect(screen.getByTestId('selected-task')).toHaveTextContent('Archived');
    expect(localStorage.getItem('task-sidebar-show-archived-/project')).toBe('false');
  });

  it('refreshes deferred descendants when a parent is restored', async () => {
    render(<ReadonlyProjectView projectDir="/project" selectedTaskId="active" onSelectTask={onSelectTask} />);
    await waitFor(() => expect(screen.getByTestId('task-active')).toBeInTheDocument());
    const parent = { id: 'parent', name: 'Parent', archived: false } as TaskData;
    const child = { id: 'child', name: 'Child', parentId: 'parent' } as TaskData;
    api.getTasks.mockResolvedValue([active, parent, child]);
    const onEvent = api.onEvent.mock.calls.at(-1)![0];

    act(() => onEvent({ type: 'task-updated', data: parent }));

    await waitFor(() => expect(screen.getByTestId('task-child')).toBeInTheDocument());
    expect(api.getTasks).toHaveBeenLastCalledWith(false);
  });
});
