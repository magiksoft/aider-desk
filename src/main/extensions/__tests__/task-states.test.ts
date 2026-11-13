import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultTaskState, SettingsData, TaskStateDefinition } from '@common/types';
import { BUILT_IN_TASK_STATE_DEFINITIONS } from '@common/task-states';

import { ExtensionManager } from '../extension-manager';
import { ExtensionLoader } from '../extension-loader';
import { ExtensionRegistry, LoadedExtension } from '../extension-registry';

import type { Extension, ExtensionContext } from '@common/extensions';
import type { Store } from '@/store';
import type { ModelManager } from '@/models';
import type { EventManager } from '@/events';
import type { TelemetryManager } from '@/telemetry';
import type { MemoryManager } from '@/memory/memory-manager';
import type { Project } from '@/project';

vi.mock('@/logger', () => ({ default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../extension-loader');

const definition = (id: string, priority = 25): TaskStateDefinition => ({ id, name: `State ${id}`, color: '#abc', priority });
const project = { baseDir: '/project' } as Project;
const globalProject = { baseDir: '/other' } as Project;

describe('task-state contributions', () => {
  let registry: ExtensionRegistry;
  let manager: ExtensionManager;
  let settings: SettingsData;
  const sendExtensionUIRefresh = vi.fn();

  const register = async (id: string, extension: Extension, projectDir?: string, initialized = true): Promise<LoadedExtension> => {
    const filePath = `/extensions/${projectDir ? projectDir.slice(1) : 'global'}/${id}.ts`;
    await registry.register(extension, { name: id, version: '1.0.0', description: id, author: 'test' }, filePath, projectDir);
    registry.setInitialized(filePath, initialized);
    return registry.getExtension(filePath)!;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    settings = { extensions: { disabled: [] } } as unknown as SettingsData;
    registry = new ExtensionRegistry();
    manager = new ExtensionManager(
      { getSettings: () => settings } as Store,
      { unregisterExtensionProviders: vi.fn() } as unknown as ModelManager,
      { sendExtensionUIRefresh, sendExtensionsUpdated: vi.fn() } as unknown as EventManager,
      {} as TelemetryManager,
      {} as MemoryManager,
      undefined,
      registry,
    );
  });

  it('preserves all built-ins and interleaves custom definitions by ascending priority and ID', async () => {
    await register('states', { getTaskStates: () => [definition('z', 25), definition('a', 25), definition('first', -5)] });
    const states = manager.getTaskStateDefinitions(project);
    expect(states.filter((state) => Object.values(DefaultTaskState).includes(state.id as DefaultTaskState))).toEqual(BUILT_IN_TASK_STATE_DEFINITIONS);
    expect(states.map((state) => state.id).slice(0, 6)).toEqual(['first', 'TODO', 'READY_FOR_IMPLEMENTATION', 'a', 'z', 'IN_PROGRESS']);
    states[0].name = 'mutated';
    expect(manager.getTaskStateDefinitions(project)[0].name).toBe('State first');
  });

  it('includes only enabled initialized extensions in the requested scope; global queries never leak project states', async () => {
    await register('global', { getTaskStates: () => [definition('global')] });
    await register(
      'local',
      {
        getTaskStates: (context) => {
          expect(context.getProjectContext().baseDir).toBe('/project');
          return [definition('local')];
        },
      },
      '/project',
    );
    await register('other', { getTaskStates: () => [definition('other')] }, '/other');
    await register('pending', { getTaskStates: () => [definition('pending')] }, undefined, false);
    const disabled = await register('disabled', { getTaskStates: () => [definition('disabled')] });
    settings.extensions!.disabled = [disabled.filePath];
    const ids = (scope?: Project) =>
      manager
        .getTaskStateDefinitions(scope)
        .filter((state) => !BUILT_IN_TASK_STATE_DEFINITIONS.some((item) => item.id === state.id))
        .map((state) => state.id);
    expect(ids(project)).toEqual(['global', 'local']);
    expect(ids(globalProject)).toEqual(['global', 'other']);
    expect(ids()).toEqual(['global']);
  });

  it('reserves built-in IDs and resolves duplicates by project, extension ID, then contribution order regardless of load order', async () => {
    await register('z', { getTaskStates: () => [{ ...definition('same'), name: 'global z' }] });
    await register('a', { getTaskStates: () => [{ ...definition('same'), name: 'global a' }] });
    await register('z', { getTaskStates: () => [{ ...definition('same'), name: 'project z' }] }, '/project');
    await register(
      'a',
      { getTaskStates: () => [{ ...definition('same'), name: 'project a' }, { ...definition('same'), name: 'second' }, definition(DefaultTaskState.Todo)] },
      '/project',
    );
    expect(manager.getTaskStateDefinitions(project).find((state) => state.id === 'same')?.name).toBe('project a');
    expect(manager.getTaskStateDefinitions().find((state) => state.id === 'same')?.name).toBe('global a');
    expect(manager.getTaskStateDefinitions(project).find((state) => state.id === DefaultTaskState.Todo)).toEqual(BUILT_IN_TASK_STATE_DEFINITIONS[0]);
  });

  it('isolates throwing extensions, malformed returns, and individual invalid entries', async () => {
    await register('throws', {
      getTaskStates: () => {
        throw new Error('failure');
      },
    });
    await register('malformed', { getTaskStates: () => null as unknown as TaskStateDefinition[] });
    await register('mixed', {
      getTaskStates: () => [null, {}, definition('ok'), { ...definition('bad'), priority: Infinity }, definition('also_ok')] as TaskStateDefinition[],
    });
    expect(
      manager
        .getTaskStateDefinitions()
        .slice(2, 4)
        .map((state) => state.id),
    ).toEqual(['also_ok', 'ok']);
  });

  it('refreshes on configuration saves and explicit context requests, and excludes unloaded states', async () => {
    let context: ExtensionContext | undefined;
    const loaded = await register(
      'configurable',
      {
        getTaskStates: () => [definition('custom')],
        saveConfigData: async (_config, ctx) => {
          context = ctx;
          return { saved: true };
        },
      },
      '/project',
    );
    await expect(manager.saveExtensionConfig(loaded.id, {}, project)).resolves.toEqual({ saved: true });
    expect(sendExtensionUIRefresh).toHaveBeenLastCalledWith({ projectDir: '/project', reloadTaskStates: true });
    context!.triggerTaskStatesRefresh();
    expect(sendExtensionUIRefresh).toHaveBeenCalledTimes(2);
    await manager.unloadExtension(loaded.filePath);
    expect(sendExtensionUIRefresh).toHaveBeenLastCalledWith({ projectDir: '/project', reloadTaskStates: true });
    expect(manager.getTaskStateDefinitions(project).some((state) => state.id === 'custom')).toBe(false);
  });

  it('refreshes after reloading an extension with no JSX contributions', async () => {
    vi.useFakeTimers();
    try {
      const loaded = await register('reloadable', { getTaskStates: () => [definition('old')] }, '/project');
      const loader = vi.mocked(ExtensionLoader).mock.instances.at(-1)!;
      vi.mocked(loader.loadExtension).mockResolvedValue({
        extension: { getTaskStates: () => [definition('new')] },
        metadata: loaded.metadata,
      });
      await expect(manager.reloadExtension(loaded.filePath, project)).resolves.toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(sendExtensionUIRefresh).toHaveBeenLastCalledWith({ reloadTaskStates: true });
      expect(manager.getTaskStateDefinitions(project).some((state) => state.id === 'old')).toBe(false);
      expect(manager.getTaskStateDefinitions(project).some((state) => state.id === 'new')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes after enable/disable and global context refresh affects every project', async () => {
    let context: ExtensionContext | undefined;
    const loaded = await register('toggle', {
      getTaskStates: () => [definition('custom')],
      saveConfigData: async (_config, ctx) => {
        context = ctx;
      },
    });
    await manager.saveExtensionConfig(loaded.id, {});
    context!.triggerTaskStatesRefresh();
    expect(sendExtensionUIRefresh).toHaveBeenLastCalledWith({ projectDir: undefined, reloadTaskStates: true });
    const old = settings;
    settings = { ...settings, extensions: { ...settings.extensions!, disabled: [loaded.filePath] } };
    await manager.settingsChanged(old, settings);
    expect(manager.getTaskStateDefinitions(project).some((state) => state.id === 'custom')).toBe(false);
    expect(sendExtensionUIRefresh).toHaveBeenLastCalledWith({ reloadTaskStates: true });
    const disabled = settings;
    settings = { ...settings, extensions: { ...settings.extensions!, disabled: [] } };
    await manager.settingsChanged(disabled, settings);
    expect(manager.getTaskStateDefinitions(project).some((state) => state.id === 'custom')).toBe(true);
    expect(sendExtensionUIRefresh).toHaveBeenLastCalledWith({ reloadTaskStates: true });
  });
});
