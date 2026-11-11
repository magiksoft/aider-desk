import fs from 'fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultTaskState, TaskData } from '@common/types';
import { fileExists } from '@common/utils';

import { Project } from '../project';

import { EMPTY_TASK_DATA, INTERNAL_TASK_ID, Task } from '@/task';

vi.mock('fs/promises');
vi.mock('@common/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@common/utils')>()),
  fileExists: vi.fn(),
}));
vi.mock('@/project/migrations', () => ({ migrateSessionsToTasks: vi.fn() }));

type ProjectInternals = {
  tasks: Map<string, Task>;
  deferredTasks: Map<string, Partial<TaskData>>;
  prepareInternalTask: () => Promise<void>;
  getTaskIdsFromDisk: () => Promise<string[]>;
  createTaskInstance: (id: string, initialTaskData?: Partial<TaskData>) => Task;
  loadTasks: () => Promise<void>;
};

describe('Project - deferred archived tasks', () => {
  let project: Project;
  let internals: ProjectInternals;
  const dispatchEvent = vi.fn(async () => ({}));
  const eventManager = {
    sendTaskCreated: vi.fn(),
    sendTaskUpdated: vi.fn(),
    sendTaskDeleted: vi.fn(),
  };
  const metadata = new Map<string, Partial<TaskData>>();

  beforeEach(() => {
    vi.clearAllMocks();
    metadata.clear();
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      const id = String(filePath).split('/').at(-2)!;
      return JSON.stringify(metadata.get(id) ?? {});
    });
    project = Object.create(Project.prototype) as Project;
    Object.assign(project, {
      baseDir: '/project',
      tasks: new Map(),
      deferredTasks: new Map(),
      tasksLoadingPromise: Promise.resolve(),
      extensionManager: { dispatchEvent },
      eventManager,
    });
    internals = project as unknown as ProjectInternals;
    vi.spyOn(internals, 'prepareInternalTask').mockResolvedValue();
    vi.spyOn(internals, 'getTaskIdsFromDisk').mockImplementation(async () => [...metadata.keys()]);
    vi.spyOn(internals, 'createTaskInstance').mockImplementation((id, initialTaskData) => {
      const task = {
        task: { ...EMPTY_TASK_DATA, ...(internals.deferredTasks.get(id) ?? initialTaskData), id, baseDir: '/project' },
        waitForTaskDataLoad: vi.fn().mockResolvedValue(undefined),
        reloadFromDisk: vi.fn().mockResolvedValue({ taskDataChanged: false }),
        close: vi.fn().mockResolvedValue(undefined),
        durabilityManager: { clear: vi.fn() },
      } as unknown as Task;
      internals.tasks.set(id, task);
      internals.deferredTasks.delete(id);
      return task;
    });
  });

  it('prepares only visible tasks at startup, including orphans but excluding archived subtrees', async () => {
    metadata.set('active', { name: 'Active' });
    metadata.set('grandchild', { parentId: 'child' });
    metadata.set('child', { parentId: 'archived' });
    metadata.set('archived', { archived: true });
    metadata.set('orphan', { parentId: 'missing' });

    await internals.loadTasks();

    expect([...internals.tasks.keys()]).toEqual(['active', 'orphan']);
    expect([...internals.deferredTasks.keys()]).toEqual(['grandchild', 'child', 'archived']);
    expect(dispatchEvent).toHaveBeenCalledTimes(2);
    expect((await project.getTasks(false)).map((task) => task.id)).toEqual(['active', 'orphan']);
    expect(internals.createTaskInstance).toHaveBeenCalledTimes(2);
  });

  it('loads archives on request, caches them, and still filters their descendants when hidden', async () => {
    metadata.set('active', {});
    metadata.set('archived', { archived: true });
    metadata.set('child', { parentId: 'archived' });
    await internals.loadTasks();

    expect((await project.getTasks(true)).map((task) => task.id)).toEqual(['active', 'archived', 'child']);
    await project.getTasks(true);
    expect(internals.createTaskInstance).toHaveBeenCalledTimes(3);
    expect((await project.getTasks(false)).map((task) => task.id)).toEqual(['active']);
  });

  it('keeps complete listings for callers that omit the archive option', async () => {
    metadata.set('archived', { archived: true });
    await internals.loadTasks();

    expect((await project.getTasks()).map((task) => task.id)).toEqual(['archived']);
  });

  it('prepares a directly requested deferred task only once without loading other archives', async () => {
    metadata.set('archived', { archived: true, name: 'Archived' });
    metadata.set('other', { archived: true });
    await internals.loadTasks();

    const task = project.getTask('archived');
    expect(task?.task.name).toBe('Archived');
    expect(project.getTask('archived')).toBe(task);
    await vi.waitFor(() => expect(dispatchEvent).toHaveBeenCalledOnce());
    expect(internals.createTaskInstance).toHaveBeenCalledTimes(1);
    expect(internals.deferredTasks.has('other')).toBe(true);
  });

  it('does not prepare a task twice when archive listings overlap', async () => {
    metadata.set('archived', { archived: true });
    metadata.set('other', { archived: true });
    await internals.loadTasks();

    const [first, second] = await Promise.all([project.getTasks(true), project.getTasks(true)]);

    expect(new Set(first.map((task) => task.id))).toEqual(new Set(['archived', 'other']));
    expect(second).toEqual(first);
    expect(internals.createTaskInstance).toHaveBeenCalledTimes(2);
    expect(dispatchEvent).toHaveBeenCalledTimes(2);
  });

  it('loads deferred descendants after their parent is unarchived', async () => {
    metadata.set('parent', { archived: true });
    metadata.set('child', { parentId: 'parent' });
    await internals.loadTasks();
    const parent = project.getTask('parent')!;
    parent.task.archived = false;

    expect((await project.getTasks(false)).map((task) => task.id)).toEqual(['parent', 'child']);
  });

  it('handles cyclic parent references without hanging', async () => {
    metadata.set('first', { parentId: 'second' });
    metadata.set('second', { parentId: 'first' });
    await internals.loadTasks();

    expect(await project.getTasks(false)).toHaveLength(2);
  });

  it('keeps archived in-progress tasks available for durable execution recovery', async () => {
    metadata.set('archived', { archived: true });
    metadata.set('running', { parentId: 'archived', state: DefaultTaskState.InProgress });
    await internals.loadTasks();

    expect([...internals.tasks.keys()]).toEqual(['running']);
    expect(await project.getTasks(false)).toEqual([]);
    expect(internals.deferredTasks.has('archived')).toBe(true);
  });

  it('reloads metadata without preparing archives and picks up newly visible tasks', async () => {
    metadata.set('archived', { archived: true });
    metadata.set('removed', { archived: true });
    await internals.loadTasks();
    metadata.delete('removed');
    metadata.set('new-archive', { archived: true });

    expect(await project.reloadTasks(false)).toEqual([]);
    expect(internals.createTaskInstance).not.toHaveBeenCalled();
    expect(internals.deferredTasks.has('removed')).toBe(false);

    metadata.set('archived', { archived: false });
    expect((await project.reloadTasks(false)).map((task) => task.id)).toEqual(['archived']);
    expect(eventManager.sendTaskCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'archived' }));
    expect(internals.deferredTasks.has('new-archive')).toBe(true);
  });

  it('does not remove a worktree shared with a deferred archived task', async () => {
    const worktree = { path: '/shared-worktree', branch: 'shared', baseBranch: 'main' };
    metadata.set('archived', { archived: true, worktree });
    await internals.loadTasks();

    expect(project.isWorktreeSharedWithOtherTasks(worktree.path, 'active')).toBe(true);
    expect(project.isWorktreeSharedWithOtherTasks(worktree.path, 'archived')).toBe(false);
  });

  it('deletes archived descendants without preparing unrelated archived tasks', async () => {
    metadata.set('parent', {});
    metadata.set('child', { parentId: 'parent', archived: true });
    metadata.set('unrelated', { archived: true });
    await internals.loadTasks();

    await project.deleteTask('parent');

    expect([...internals.tasks.keys()]).toEqual([]);
    expect([...internals.deferredTasks.keys()]).toEqual(['unrelated']);
    expect(eventManager.sendTaskDeleted).toHaveBeenCalledTimes(2);
    expect(internals.createTaskInstance).toHaveBeenCalledTimes(2);
  });

  it('never includes the internal task in listings', async () => {
    internals.createTaskInstance(INTERNAL_TASK_ID);
    expect(await project.getTasks(false)).toEqual([]);
  });
});
