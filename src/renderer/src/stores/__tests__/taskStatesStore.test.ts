import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskStateDefinition } from '@common/types';

import { useTaskStatesStore } from '../taskStatesStore';

const state = (id: string): TaskStateDefinition => ({ id, name: id, color: '#abc', priority: 25 });

describe('task-state store', () => {
  beforeEach(() => {
    useTaskStatesStore.setState({ definitions: new Map(), requests: new Map() });
  });

  it('caches definitions independently per project and explicitly refreshes removal', async () => {
    const api = { getTaskStateDefinitions: vi.fn(async (projectDir?: string) => [state(projectDir ?? 'global')]) };
    const store = useTaskStatesStore.getState();
    await store.load(api, '/one');
    await store.load(api, '/two');
    await store.load(api, '/one');
    expect(api.getTaskStateDefinitions).toHaveBeenCalledTimes(2);
    expect(useTaskStatesStore.getState().definitions.get('/one')?.[0].id).toBe('/one');
    expect(useTaskStatesStore.getState().definitions.get('/two')?.[0].id).toBe('/two');
    api.getTaskStateDefinitions.mockResolvedValue([]);
    await store.load(api, '/one', true);
    expect(useTaskStatesStore.getState().definitions.get('/one')).toEqual([]);
  });

  it('ignores an older response that completes after a refresh', async () => {
    let resolveOld: (states: TaskStateDefinition[]) => void = () => {};
    const old = new Promise<TaskStateDefinition[]>((resolve) => {
      resolveOld = resolve;
    });
    const api = {
      getTaskStateDefinitions: vi
        .fn()
        .mockReturnValueOnce(old)
        .mockResolvedValueOnce([state('new')]),
    };
    const first = useTaskStatesStore.getState().load(api, '/one');
    await useTaskStatesStore.getState().load(api, '/one', true);
    resolveOld([state('old')]);
    await first;
    expect(useTaskStatesStore.getState().definitions.get('/one')?.[0].id).toBe('new');
  });

  it('keeps previous definitions on failure and allows retry', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = {
      getTaskStateDefinitions: vi
        .fn()
        .mockResolvedValueOnce([state('cached')])
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce([]),
    };
    await useTaskStatesStore.getState().load(api, '/one');
    await useTaskStatesStore.getState().load(api, '/one', true);
    expect(useTaskStatesStore.getState().definitions.get('/one')?.[0].id).toBe('cached');
    expect(useTaskStatesStore.getState().requests.size).toBe(0);
    await useTaskStatesStore.getState().load(api, '/one', true);
    expect(useTaskStatesStore.getState().definitions.get('/one')).toEqual([]);
    consoleError.mockRestore();
  });
});
