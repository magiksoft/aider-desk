import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskCreatedData, TaskData, TaskStateData } from '@common/types';
import { HotkeysProvider } from 'react-hotkeys-hook';

import { ProjectView } from '../ProjectView';

import { releaseTaskFiles } from '@/stores/taskFilesStore';
import { useApi } from '@/contexts/ApiContext';
import { useSettingsStore } from '@/stores/settingsStore';
import { useProjectSettings } from '@/contexts/ProjectSettingsContext';
import { invokeAction } from '@/stores/actionsStore';
import { createMockApi } from '@/__tests__/mocks/api';

const commandPaletteStoreMock = vi.hoisted(() => {
  type MockPaletteItem = {
    id: string;
    action: () => void;
  };

  const providersByScope = new Map<string, () => MockPaletteItem[]>();
  const setItemsProvider = vi.fn((scope: string, provider: () => MockPaletteItem[]) => {
    providersByScope.set(scope, provider);
  });
  const clearItems = vi.fn((scope: string) => {
    providersByScope.delete(scope);
  });
  const collectItems = () => new Map(Array.from(providersByScope.values()).flatMap((provider) => provider().map((item) => [item.id, item] as const)));
  const reset = () => {
    providersByScope.clear();
    setItemsProvider.mockClear();
    clearItems.mockClear();
  };

  return { collectItems, providersByScope, setItemsProvider, clearItems, reset };
});

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock contexts
vi.mock('@/contexts/ApiContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/ApiContext')>()),
  useApi: vi.fn(),
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: vi.fn(),
}));

vi.mock('@/contexts/ProjectSettingsContext', () => ({
  useProjectSettings: vi.fn(),
}));

vi.mock('@/stores/taskFilesStore', () => ({
  releaseTaskFiles: vi.fn(),
  useTaskAllFiles: vi.fn(() => ['src/file.ts']),
}));

// Mock useAgents hook
vi.mock('@/contexts/AgentsContext', () => ({
  useAgents: vi.fn(() => ({
    getProfiles: () => [],
    getActiveProfile: () => null,
    setActiveProfile: vi.fn(),
    refreshProfiles: vi.fn(),
  })),
}));

// Mock command palette store
vi.mock('@/stores/commandPaletteStore', () => ({
  useCommandPaletteStore: vi.fn((selector) =>
    selector({
      setItemsProvider: commandPaletteStoreMock.setItemsProvider,
      clearItems: commandPaletteStoreMock.clearItems,
    }),
  ),
  PaletteItemType: {
    Action: 'action',
    File: 'file',
    Task: 'task',
    Project: 'project',
  },
}));

const taskSidebarMock = vi.hoisted(() => ({
  startRenaming: vi.fn(),
}));

interface TaskSidebarMockProps {
  projectDir: string;
  showArchived: boolean;
  onShowArchivedChange: (show: boolean) => void;
  tasks: TaskData[];
  onTaskSelect: (taskId: string) => void;
  deleteTask?: (taskId: string) => Promise<void>;
}

// Mock components
vi.mock('@/components/project/TaskSidebar/TaskSidebar', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  const TaskSidebar = forwardRef(({ tasks, onTaskSelect, projectDir, showArchived, onShowArchivedChange }: TaskSidebarMockProps, ref) => {
    useImperativeHandle(ref, () => ({
      startRenaming: taskSidebarMock.startRenaming,
    }));
    return (
      <div data-testid="task-sidebar">
        <button data-testid={`archive-toggle-${projectDir}`} onClick={() => onShowArchivedChange(!showArchived)}>
          Toggle archives
        </button>
        {tasks.map((task) => (
          <button key={task.id} onClick={() => onTaskSelect(task.id)} data-testid={`task-${task.id}`}>
            {task.name}
          </button>
        ))}
      </div>
    );
  });
  return { TaskSidebar, COLLAPSED_WIDTH: 44, EXPANDED_WIDTH: 256 };
});

vi.mock('../TaskView', () => ({
  TaskView: ({ task, isActive }: { task: TaskData; isActive?: boolean }) => (
    <div data-testid="task-view" data-active={isActive ? 'true' : 'false'}>
      {task.name}
    </div>
  ),
}));

vi.mock('@/components/extensions/FloatingExtensionPanels', () => ({
  FloatingExtensionPanels: () => null,
}));

vi.mock('@/components/Workspace/FileEditorModal', async () => {
  const { useFileEditorStore } = await import('@/stores/fileEditorStore');
  return {
    FileEditorModal: ({ baseDir }: { baseDir: string }) => {
      const openFiles = useFileEditorStore((state) => state.projectsMap.get(baseDir)?.openFiles ?? []);
      const activeFilePath = useFileEditorStore((state) => state.projectsMap.get(baseDir)?.activeFilePath ?? null);
      const activeFile = openFiles.find((file) => file.path === activeFilePath) ?? null;
      return <div data-testid="file-editor-modal" data-base-dir={baseDir} data-file-path={activeFile?.path} data-task-id={activeFile?.taskId} />;
    },
  };
});

describe('ProjectView', () => {
  const projectDir = '/mock/project';
  const mockApi = createMockApi({
    startProject: vi.fn(() => Promise.resolve()),
    getTasks: vi.fn(() => Promise.resolve([{ id: 'task-1', name: 'Task 1' }] as TaskData[])),
    createNewTask: vi.fn(() => Promise.resolve({ id: 'task-2', name: 'Task 2' } as TaskData)),
    loadTask: vi.fn(() =>
      Promise.resolve({
        messages: [],
        files: [],
        todoItems: [],
        queuedPrompts: [],
        question: null,
        workingMode: 'local',
      } as TaskStateData),
    ),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    commandPaletteStoreMock.reset();
    mockApi.getTasks.mockResolvedValue([{ id: 'task-1', name: 'Task 1' }] as TaskData[]);
    mockApi.getCustomModes.mockResolvedValue([]);
    vi.mocked(useApi).mockReturnValue(mockApi);
    vi.mocked(useSettingsStore).mockImplementation(((selector: (state: unknown) => unknown) =>
      selector({
        settings: { startupMode: 'empty' },
        theme: 'dark',
        font: 'Sono',
        fontSize: 14,
        setSettingsState: vi.fn(),
        setThemeValue: vi.fn(),
        setFontValue: vi.fn(),
        setFontSizeValue: vi.fn(),
      })) as never);
    vi.mocked(useProjectSettings).mockReturnValue({
      projectSettings: {},
    } as ReturnType<typeof useProjectSettings>);
  });

  it('initializes project and loads tasks', async () => {
    render(<ProjectView projectDir={projectDir} isProjectActive={true} />);

    await waitFor(() => {
      expect(mockApi.startProject).toHaveBeenCalledWith(projectDir);
      expect(mockApi.getTasks).toHaveBeenCalledWith(projectDir, false);
    });
  });

  it('loads archived tasks only after the archive filter is enabled', async () => {
    render(<ProjectView projectDir={projectDir} isProjectActive={true} />);
    await waitFor(() => expect(mockApi.getTasks).toHaveBeenCalledWith(projectDir, false));
    expect(mockApi.getTasks).not.toHaveBeenCalledWith(projectDir, true);

    mockApi.getTasks.mockResolvedValue([
      { id: 'task-1', name: 'Task 1' },
      { id: 'archived', name: 'Archived task', archived: true },
    ] as TaskData[]);
    fireEvent.click(screen.getByTestId(`archive-toggle-${projectDir}`));

    await waitFor(() => expect(screen.getByTestId('task-archived')).toBeInTheDocument());
    expect(mockApi.getTasks).toHaveBeenCalledWith(projectDir, true);

    const calls = mockApi.getTasks.mock.calls.length;
    fireEvent.click(screen.getByTestId(`archive-toggle-${projectDir}`));
    expect(mockApi.getTasks).toHaveBeenCalledTimes(calls);
  });

  it('does not load another project archives when toggling the active project filter', async () => {
    const otherProjectDir = '/other/project';
    render(
      <>
        <ProjectView projectDir={projectDir} isProjectActive={true} />
        <ProjectView projectDir={otherProjectDir} isProjectActive={false} />
      </>,
    );
    await waitFor(() => {
      expect(mockApi.getTasks).toHaveBeenCalledWith(projectDir, false);
      expect(mockApi.getTasks).toHaveBeenCalledWith(otherProjectDir, false);
    });
    mockApi.getTasks.mockClear();

    fireEvent.click(screen.getByTestId(`archive-toggle-${projectDir}`));

    await waitFor(() => expect(mockApi.getTasks).toHaveBeenCalledWith(projectDir, true));
    expect(mockApi.getTasks).not.toHaveBeenCalledWith(otherProjectDir, true);
    expect(mockApi.startProject).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(`task-sidebar-show-archived-${otherProjectDir}`)).toBe('false');
  });

  it('persists the archive filter across project remounts', async () => {
    const view = render(<ProjectView projectDir={projectDir} isProjectActive={true} />);
    await waitFor(() => expect(mockApi.getTasks).toHaveBeenCalledWith(projectDir, false));
    fireEvent.click(screen.getByTestId(`archive-toggle-${projectDir}`));
    await waitFor(() => expect(mockApi.getTasks).toHaveBeenCalledWith(projectDir, true));
    view.unmount();
    mockApi.getTasks.mockClear();

    render(<ProjectView projectDir={projectDir} isProjectActive={true} />);

    await waitFor(() => expect(mockApi.getTasks).toHaveBeenCalledExactlyOnceWith(projectDir, true));
  });

  it('routes archive palette commands to the active project after switching projects', async () => {
    const otherProjectDir = '/other/project';
    const view = render(
      <>
        <ProjectView projectDir={projectDir} isProjectActive={true} />
        <ProjectView projectDir={otherProjectDir} isProjectActive={false} />
      </>,
    );
    await waitFor(() => expect(mockApi.getTasks).toHaveBeenCalledWith(otherProjectDir, false));
    act(() => invokeAction('task.showArchived'));
    await waitFor(() => expect(mockApi.getTasks).toHaveBeenCalledWith(projectDir, true));
    expect(commandPaletteStoreMock.collectItems().has('task.hideArchived')).toBe(true);
    expect(commandPaletteStoreMock.collectItems().has('task.showArchived')).toBe(false);

    view.rerender(
      <>
        <ProjectView projectDir={projectDir} isProjectActive={false} />
        <ProjectView projectDir={otherProjectDir} isProjectActive={true} />
      </>,
    );
    expect(commandPaletteStoreMock.collectItems().has('task.showArchived')).toBe(true);
    act(() => invokeAction('task.showArchived'));
    await waitFor(() => expect(mockApi.getTasks).toHaveBeenCalledWith(otherProjectDir, true));
    act(() => invokeAction('task.hideArchived'));
    expect(localStorage.getItem(`task-sidebar-show-archived-${projectDir}`)).toBe('true');
    expect(localStorage.getItem(`task-sidebar-show-archived-${otherProjectDir}`)).toBe('false');
  });

  it('enables the archive filter to open an archived task from a deep link', async () => {
    mockApi.getTasks.mockImplementation(async (_projectDir, includeArchived) =>
      includeArchived ? ([{ id: 'archived', name: 'Archived task', archived: true }] as TaskData[]) : ([{ id: 'task-1', name: 'Task 1' }] as TaskData[]),
    );
    render(<ProjectView projectDir={projectDir} initialTaskId="archived" isProjectActive={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('task-view')).toHaveTextContent('Archived task');
    });
    expect(localStorage.getItem(`task-sidebar-show-archived-${projectDir}`)).toBe('true');
    expect(mockApi.getTasks.mock.calls).toEqual([
      [projectDir, false],
      [projectDir, true],
    ]);
  });

  it('includes archives in the initial request when the filter is already enabled', async () => {
    localStorage.setItem(`task-sidebar-show-archived-${projectDir}`, 'true');
    render(<ProjectView projectDir={projectDir} isProjectActive={true} />);

    await waitFor(() => expect(screen.getByTestId('task-task-1')).toBeInTheDocument());
    expect(mockApi.getTasks).toHaveBeenCalledExactlyOnceWith(projectDir, true);
  });

  it.each([false, true])('respects showArchived=%s when resyncing after reconnect', async (showArchived) => {
    localStorage.setItem(`task-sidebar-show-archived-${projectDir}`, String(showArchived));
    render(<ProjectView projectDir={projectDir} isProjectActive={true} />);
    await waitFor(() => expect(screen.getByTestId('task-task-1')).toBeInTheDocument());
    const reconnect = mockApi.addSocketReconnectListener.mock.calls.at(-1)![0];
    mockApi.getTasks.mockClear();

    act(() => reconnect());

    await waitFor(() => expect(mockApi.getTasks).toHaveBeenCalledWith(projectDir, showArchived));
  });

  it('fetches deferred descendants when a parent is unarchived', async () => {
    render(<ProjectView projectDir={projectDir} isProjectActive={true} />);
    await waitFor(() => expect(screen.getByTestId('task-task-1')).toBeInTheDocument());
    const onTaskUpdated = mockApi.addTaskUpdatedListener.mock.calls[0][1];
    mockApi.getTasks.mockResolvedValue([
      { id: 'task-1', name: 'Task 1' },
      { id: 'parent', name: 'Restored parent', archived: false },
      { id: 'child', name: 'Restored child', parentId: 'parent' },
    ] as TaskData[]);

    act(() => onTaskUpdated({ id: 'parent', name: 'Restored parent', archived: false } as TaskData));

    await waitFor(() => expect(screen.getByTestId('task-child')).toBeInTheDocument());
    expect(mockApi.getTasks).toHaveBeenLastCalledWith(projectDir, false);
  });

  it('renders task sidebar and active task view', async () => {
    render(<ProjectView projectDir={projectDir} isProjectActive={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('task-view')).toBeInTheDocument();
    });

    // Task 1 should be in the mocked TaskSidebar (appears twice: once from mock sidebar and once from mock task view)
    expect(screen.getAllByText('Task 1')).toHaveLength(2);
  });

  it('does not load any task in a background project until first-time activation', async () => {
    mockApi.getTasks.mockResolvedValue([
      { id: 'task-1', name: 'Task 1', baseDir: projectDir },
      { id: 'task-2', name: 'Task 2', baseDir: projectDir },
    ] as TaskData[]);

    const { rerender } = render(<ProjectView projectDir={projectDir} isProjectActive={false} />);
    await waitFor(() => expect(mockApi.getTasks).toHaveBeenCalledWith(projectDir, false));

    expect(mockApi.createNewTask).not.toHaveBeenCalled();
    expect(mockApi.loadTask).not.toHaveBeenCalled();
    expect(screen.queryByTestId('task-view')).not.toBeInTheDocument();

    rerender(<ProjectView projectDir={projectDir} isProjectActive={true} />);

    await waitFor(() => {
      const activeView = screen.getAllByTestId('task-view').find((el) => el.getAttribute('data-active') === 'true');
      expect(activeView).toHaveTextContent('Task 1');
    });
  });

  it('creates a new task on first-time activation for background projects in Empty mode', async () => {
    mockApi.getTasks.mockResolvedValue([{ id: 'task-1', name: 'Task 1', baseDir: projectDir, createdAt: '2023-01-01T00:00:00Z' }] as TaskData[]);
    let taskCreatedHandler: (data: TaskCreatedData) => void = () => {};
    mockApi.addTaskCreatedListener.mockImplementation((_projectDir: string, handler: (data: TaskCreatedData) => void) => {
      taskCreatedHandler = handler;
      return () => undefined;
    });
    mockApi.createNewTask.mockImplementation(async () => {
      const newTask = { id: 'task-2', name: 'Task 2', baseDir: projectDir } as TaskData;
      taskCreatedHandler({ task: newTask, baseDir: projectDir, activate: true });
      return newTask;
    });
    const { rerender } = render(<ProjectView projectDir={projectDir} isProjectActive={false} />);
    await waitFor(() => expect(mockApi.getTasks).toHaveBeenCalledWith(projectDir, false));
    expect(mockApi.createNewTask).not.toHaveBeenCalled();

    rerender(<ProjectView projectDir={projectDir} isProjectActive={true} />);

    await waitFor(() => expect(mockApi.createNewTask).toHaveBeenCalledWith(projectDir));
    await waitFor(() => {
      const activeView = screen.getAllByTestId('task-view').find((el) => el.getAttribute('data-active') === 'true');
      expect(activeView).toHaveTextContent('Task 2');
    });

    mockApi.createNewTask.mockImplementation(() => Promise.resolve({ id: 'task-2', name: 'Task 2' } as TaskData));
    mockApi.addTaskCreatedListener.mockImplementation(() => () => undefined);
  });

  it('excludes archived tasks from the command palette metadata', async () => {
    mockApi.getTasks.mockResolvedValue([
      { id: 'task-1', name: 'Active Task', baseDir: projectDir, archived: false },
      { id: 'task-2', name: 'Archived Task', baseDir: projectDir, archived: true },
    ] as TaskData[]);

    render(<ProjectView projectDir={projectDir} isProjectActive={true} />);

    await waitFor(() => expect(commandPaletteStoreMock.collectItems().get(`task.switch.${projectDir}.task-2`)).toBeDefined());

    expect(commandPaletteStoreMock.collectItems().get(`task.switch.${projectDir}.task-1`)).toMatchObject({ archived: false });
    expect(commandPaletteStoreMock.collectItems().get(`task.switch.${projectDir}.task-2`)).toMatchObject({ archived: true });
  });

  it('keeps a command palette file preview bound to its originating task after switching tasks', async () => {
    mockApi.getTasks.mockResolvedValue([
      { id: 'task-1', name: 'Task 1', baseDir: projectDir },
      { id: 'task-2', name: 'Task 2', baseDir: projectDir, worktree: { path: '/mock/worktrees/task-2' } },
    ] as TaskData[]);

    render(<ProjectView projectDir={projectDir} isProjectActive={true} />);

    await waitFor(() => expect(screen.getByTestId('task-view')).toHaveTextContent('Task 1'));
    await waitFor(() => expect(commandPaletteStoreMock.collectItems().get(`file.open.${projectDir}.src/file.ts`)).toBeDefined());

    act(() => commandPaletteStoreMock.collectItems().get(`file.open.${projectDir}.src/file.ts`)?.action());

    expect(await screen.findByTestId('file-editor-modal')).toHaveAttribute('data-task-id', 'task-1');

    fireEvent.click(screen.getByTestId('task-task-2'));

    // Recently-active tasks stay mounted (keep-alive), so assert on the active (visible) task view.
    await waitFor(() => {
      const activeView = screen.getAllByTestId('task-view').find((el) => el.getAttribute('data-active') === 'true');
      expect(activeView).toHaveTextContent('Task 2');
    });
    expect(screen.getByTestId('file-editor-modal')).toHaveAttribute('data-task-id', 'task-1');
  });

  it('keeps the file editor mounted while closed and reuses it on reopen', async () => {
    const { useFileEditorStore } = await import('@/stores/fileEditorStore');
    render(<ProjectView projectDir={projectDir} isProjectActive={true} />);

    act(() => useFileEditorStore.getState().openFile(projectDir, 'src/file.ts', 'task-1'));
    const editor = await screen.findByTestId('file-editor-modal');
    expect(editor).toBeVisible();

    act(() => useFileEditorStore.getState().closeEditor(projectDir));
    expect(editor).toBeInTheDocument();
    expect(editor).not.toBeVisible();

    act(() => useFileEditorStore.getState().openEditor(projectDir));
    expect(screen.getByTestId('file-editor-modal')).toBe(editor);
    expect(editor).toBeVisible();
  });

  it('opens the editor with Ctrl+E when no files have been opened', async () => {
    const { useFileEditorStore } = await import('@/stores/fileEditorStore');
    const emptyProjectDir = '/mock/empty-project';
    render(
      <HotkeysProvider initiallyActiveScopes={['task']}>
        <ProjectView projectDir={emptyProjectDir} isProjectActive={true} />
      </HotkeysProvider>,
    );
    await screen.findByTestId('task-view');
    expect(screen.queryByTestId('file-editor-modal')).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'e', code: 'KeyE', ctrlKey: true });
    expect(screen.getByTestId('file-editor-modal')).toBeVisible();
    expect(useFileEditorStore.getState().projectsMap.get(emptyProjectDir)?.openFiles).toEqual([]);
    fireEvent.keyUp(document, { key: 'e', code: 'KeyE', ctrlKey: true });
  });

  it('opens the editor only in the active project with Ctrl+E after switching projects', async () => {
    const { useFileEditorStore } = await import('@/stores/fileEditorStore');
    const otherProjectDir = '/mock/other-project';
    const renderProjects = (activeProjectDir: string) => (
      <HotkeysProvider initiallyActiveScopes={['task']}>
        <ProjectView projectDir={projectDir} isProjectActive={activeProjectDir === projectDir} />
        <ProjectView projectDir={otherProjectDir} isProjectActive={activeProjectDir === otherProjectDir} />
      </HotkeysProvider>
    );
    const { rerender } = render(renderProjects(projectDir));
    await waitFor(() => expect(screen.getAllByTestId('task-view')).toHaveLength(1));

    rerender(renderProjects(otherProjectDir));
    await waitFor(() => expect(screen.getAllByTestId('task-view')).toHaveLength(2));

    act(() => {
      const store = useFileEditorStore.getState();
      store.openFile(projectDir, 'src/file.ts', 'task-1');
      store.closeEditor(projectDir);
      store.openFile(otherProjectDir, 'src/file.ts', 'task-1');
      store.closeEditor(otherProjectDir);
    });

    fireEvent.keyDown(document, { key: 'e', code: 'KeyE', ctrlKey: true });
    expect(useFileEditorStore.getState().projectsMap.get(otherProjectDir)?.isEditorOpen).toBe(true);
    expect(useFileEditorStore.getState().projectsMap.get(projectDir)?.isEditorOpen).toBe(false);
    fireEvent.keyUp(document, { key: 'e', code: 'KeyE', ctrlKey: true });

    act(() => useFileEditorStore.getState().closeEditor(otherProjectDir));
    rerender(renderProjects(projectDir));

    fireEvent.keyDown(document, { key: 'e', code: 'KeyE', ctrlKey: true });
    expect(useFileEditorStore.getState().projectsMap.get(projectDir)?.isEditorOpen).toBe(true);
    expect(useFileEditorStore.getState().projectsMap.get(otherProjectDir)?.isEditorOpen).toBe(false);
    fireEvent.keyUp(document, { key: 'e', code: 'KeyE', ctrlKey: true });
  });

  it('never evicts in-progress tasks from the mount pool', async () => {
    mockApi.getTasks.mockResolvedValue(
      Array.from({ length: 7 }, (_, index) => ({
        id: `task-${index + 1}`,
        name: `Task ${index + 1}`,
        baseDir: projectDir,
        createdAt: `2023-01-0${index + 1}T00:00:00Z`,
      })) as TaskData[],
    );

    let taskStartedHandler: (taskData: TaskData) => void = () => {};
    mockApi.addTaskStartedListener.mockImplementation((_baseDir: string, handler: (taskData: TaskData) => void) => {
      taskStartedHandler = handler;
      return () => undefined;
    });

    render(<ProjectView projectDir={projectDir} isProjectActive={true} initialTaskId="task-1" />);

    await waitFor(() => expect(screen.getByTestId('task-view')).toHaveTextContent('Task 1'));

    for (const taskId of ['task-2', 'task-3', 'task-4', 'task-5']) {
      fireEvent.click(screen.getByTestId(`task-${taskId}`));
    }

    // Task 1 starts processing while it is the least recently used task in the pool.
    act(() => {
      taskStartedHandler({ id: 'task-1', name: 'Task 1', baseDir: projectDir, state: 'IN_PROGRESS' } as TaskData);
    });

    fireEvent.click(screen.getByTestId('task-task-6'));

    await waitFor(() => {
      const activeView = screen.getAllByTestId('task-view').find((el) => el.getAttribute('data-active') === 'true');
      expect(activeView).toHaveTextContent('Task 6');
    });
    expect(screen.getAllByTestId('task-view')).toHaveLength(6);
    expect(releaseTaskFiles).not.toHaveBeenCalledWith('task-1');

    fireEvent.click(screen.getByTestId('task-task-7'));

    await waitFor(() => expect(releaseTaskFiles).toHaveBeenCalledWith('task-2'));
    const mountedViews = screen.getAllByTestId('task-view');
    expect(mountedViews).toHaveLength(6);
    expect(mountedViews.find((el) => el.textContent === 'Task 1')).toBeInTheDocument();
    expect(mountedViews.find((el) => el.textContent === 'Task 2')).toBeUndefined();

    mockApi.addTaskStartedListener.mockImplementation(() => () => undefined);
  });

  const setupSettings = (startupMode: string) => {
    vi.mocked(useSettingsStore).mockImplementation(((selector: (state: unknown) => unknown) =>
      selector({
        settings: { startupMode },
        theme: 'dark',
        font: 'Sono',
        fontSize: 14,
        setSettingsState: vi.fn(),
        setThemeValue: vi.fn(),
        setFontValue: vi.fn(),
        setFontSizeValue: vi.fn(),
      })) as never);
  };

  const setupSubtaskProject = async (activeTaskName: string) => {
    setupSettings('last');
    mockApi.getTasks.mockResolvedValue([
      { id: 'parent-1', name: 'Parent Task', baseDir: projectDir, parentId: null, createdAt: '2023-01-01T00:00:00Z', updatedAt: '2023-01-01T00:00:00Z' },
      { id: 'child-1', name: 'Child Task', baseDir: projectDir, parentId: 'parent-1', createdAt: '2023-01-02T00:00:00Z', updatedAt: '2023-01-02T00:00:00Z' },
    ] as TaskData[]);

    render(<ProjectView projectDir={projectDir} isProjectActive={true} />);

    await waitFor(() => expect(screen.getByTestId('task-view')).toHaveTextContent(activeTaskName));
  };

  it('creates a subtask of the active task from the palette action', async () => {
    await setupSubtaskProject('Child Task');

    act(() => invokeAction('task.newSubtask'));

    await waitFor(() => expect(mockApi.createNewTask).toHaveBeenCalledWith(projectDir, { parentId: 'child-1' }));
  });

  it('registers a sibling task palette action only when the active task is a subtask', async () => {
    await setupSubtaskProject('Child Task');

    const siblingItem = commandPaletteStoreMock.collectItems().get('task.newSibling');
    expect(siblingItem).toBeDefined();

    act(() => siblingItem!.action());

    await waitFor(() => expect(mockApi.createNewTask).toHaveBeenCalledWith(projectDir, { parentId: 'parent-1' }));
  });

  it('does not register a sibling task palette action when the active task is top-level', async () => {
    setupSettings('last');
    mockApi.getTasks.mockResolvedValue([
      { id: 'parent-1', name: 'Parent Task', baseDir: projectDir, parentId: null, createdAt: '2023-01-01T00:00:00Z', updatedAt: '2023-01-01T00:00:00Z' },
    ] as TaskData[]);

    render(<ProjectView projectDir={projectDir} isProjectActive={true} />);

    await waitFor(() => expect(screen.getByTestId('task-view')).toHaveTextContent('Parent Task'));

    expect(commandPaletteStoreMock.collectItems().get('task.newSibling')).toBeUndefined();
  });

  it('renames the active task through the sidebar from the palette action', async () => {
    await setupSubtaskProject('Child Task');

    act(() => invokeAction('task.rename'));

    expect(taskSidebarMock.startRenaming).toHaveBeenCalledWith('child-1');
  });

  it('changes the task state through the palette action', async () => {
    await setupSubtaskProject('Child Task');

    act(() => invokeAction('task.state.done'));

    await waitFor(() => expect(mockApi.updateTask).toHaveBeenCalledWith(projectDir, 'child-1', { state: 'DONE' }));
  });

  it('switches the active task mode through built-in palette actions', async () => {
    await setupSubtaskProject('Child Task');

    act(() => invokeAction('task.mode.code'));

    await waitFor(() => expect(mockApi.updateTask).toHaveBeenCalledWith(projectDir, 'child-1', { currentMode: 'code' }));
  });

  it('registers and invokes custom mode palette actions', async () => {
    mockApi.getCustomModes.mockResolvedValue([{ name: 'plan', label: 'Plan', description: 'Plan first' }]);
    await setupSubtaskProject('Child Task');

    const planModeItem = await waitFor(() => {
      const item = commandPaletteStoreMock.collectItems().get('task.mode.plan');
      expect(item).toBeDefined();
      return item!;
    });

    act(() => planModeItem.action());

    await waitFor(() => expect(mockApi.updateTask).toHaveBeenCalledWith(projectDir, 'child-1', { currentMode: 'plan' }));
  });

  it('registers a pin palette action with state-aware label', async () => {
    await setupSubtaskProject('Child Task');

    const pinItem = commandPaletteStoreMock.collectItems().get('task.togglePin');
    expect(pinItem).toMatchObject({ label: 'taskSidebar.pinTask' });

    act(() => pinItem!.action());

    await waitFor(() => expect(mockApi.updateTask).toHaveBeenCalledWith(projectDir, 'child-1', { pinned: true }));
  });

  it('creates a new task when the active task is deleted', async () => {
    mockApi.getTasks.mockResolvedValue([
      {
        id: 'task-1',
        name: 'Task 1',
        createdAt: '2023-01-01T00:00:00Z',
        aiderTotalCost: 0,
        agentTotalCost: 0,
        mainModel: 'gpt-4',
      },
    ] as TaskData[]);

    render(<ProjectView projectDir={projectDir} isProjectActive={true} />);

    // Wait for API calls to complete
    await waitFor(() => {
      expect(mockApi.startProject).toHaveBeenCalledWith(projectDir);
      expect(mockApi.getTasks).toHaveBeenCalledWith(projectDir, false);
    });
  });
});
