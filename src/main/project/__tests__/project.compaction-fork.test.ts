import { describe, expect, it, vi } from 'vitest';
import { ContextMessage, DefaultTaskState } from '@common/types';

import { Project } from '../project';

const checkpointId = 'context.pre-compaction.002.json';

const createProject = (messages: ContextMessage[] | null) => {
  const source = {
    task: { id: 'source', parentId: null, name: 'Source', state: DefaultTaskState.InProgress, workingMode: 'worktree', worktree: { path: '/worktree' } },
    readCompactionCheckpoint: vi.fn(async () => messages),
  };
  const fork = { task: { id: 'fork' }, init: vi.fn(), forkFrom: vi.fn() };
  const prepareTask = vi.fn(async () => fork);
  const sendTaskCreated = vi.fn();
  const project = Object.create(Project.prototype) as Project;
  Object.assign(project, { tasks: new Map([['source', source]]), prepareTask, eventManager: { sendTaskCreated } });
  return { project, source, fork, prepareTask, sendTaskCreated };
};

describe('Project - compaction forks', () => {
  it('validates the checkpoint before creating a task and reuses fork settings and navigation', async () => {
    const messages: ContextMessage[] = [{ id: 'before', role: 'user', content: 'Before compaction' }];
    const { project, source, fork, prepareTask, sendTaskCreated } = createProject(messages);
    expect(await project.forkTaskFromCheckpoint('source', checkpointId)).toEqual(fork.task);
    expect(source.readCompactionCheckpoint).toHaveBeenCalledWith(checkpointId);
    expect(prepareTask).toHaveBeenCalledWith(undefined, { ...source.task, parentId: 'source', state: DefaultTaskState.Todo });
    expect(fork.init).toHaveBeenCalledOnce();
    expect(fork.forkFrom).toHaveBeenCalledWith(source, messages, checkpointId);
    expect(sendTaskCreated).toHaveBeenCalledWith(fork.task, true);
    expect(source.task.state).toBe(DefaultTaskState.InProgress);
  });

  it('does not create a task for a missing or invalid checkpoint', async () => {
    const { project, prepareTask, sendTaskCreated } = createProject(null);
    await expect(project.forkTaskFromCheckpoint('source', checkpointId)).rejects.toThrow('Compaction checkpoint is missing or unreadable');
    expect(prepareTask).not.toHaveBeenCalled();
    expect(sendTaskCreated).not.toHaveBeenCalled();
  });

  it('does not create a task when the source is missing', async () => {
    const { project, prepareTask } = createProject([]);
    await expect(project.forkTaskFromCheckpoint('missing', checkpointId)).rejects.toThrow('Task with id missing not found');
    expect(prepareTask).not.toHaveBeenCalled();
  });

  it('preserves ordinary message-based forks', async () => {
    const { project, source, fork } = createProject(null);
    await project.forkTask('source', 'message');
    expect(source.readCompactionCheckpoint).not.toHaveBeenCalled();
    expect(fork.forkFrom).toHaveBeenCalledWith(source, 'message', undefined);
  });
});
