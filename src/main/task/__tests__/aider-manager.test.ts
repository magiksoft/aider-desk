import { spawn } from 'child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiderSettingsData, TaskData } from '@common/types';

import { AiderManager } from '../aider-manager';

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn: vi.fn(),
}));

type FakeAiderProcess = { pid?: number };

const createManager = () => {
  const task = {
    getProjectDir: () => '/tmp/aider-desk-test-project',
    getTaskDir: () => '/tmp/aider-desk-test-project/task',
    task: { id: 'task-id' },
    taskId: 'task-id',
  };
  const eventManager = {
    sendAiderConnectorStatus: vi.fn(),
  };

  return {
    manager: new AiderManager(task as never, {} as never, {} as never, eventManager as never, () => [], {} as never),
    eventManager,
  };
};

describe('AiderManager process lifecycle', () => {
  it('clears the started state and reports a startup failure when the child exits naturally', () => {
    const { manager, eventManager } = createManager();
    const process = { pid: 1234 } as FakeAiderProcess;
    const internals = manager as unknown as {
      aiderProcess: FakeAiderProcess | null;
      aiderStarting: boolean;
      currentCommand: string | null;
      handleAiderProcessExit: (process: FakeAiderProcess, code: number | null) => void;
    };

    internals.aiderProcess = process;
    internals.aiderStarting = true;
    internals.currentCommand = 'ask';

    internals.handleAiderProcessExit(process, 0);

    expect(manager.isStarted()).toBe(false);
    expect(internals.currentCommand).toBeNull();
    expect(eventManager.sendAiderConnectorStatus).toHaveBeenCalledWith(
      { state: 'failed', error: 'Aider process exited before the connector became ready (code 0)' },
      '/tmp/aider-desk-test-project',
      'task-id',
    );
  });
});

describe('AiderManager scoped settings and model inheritance', () => {
  const setup = (overrides: Partial<AiderSettingsData> = {}, taskModels: Partial<TaskData> = {}) => {
    const task = {
      getProjectDir: () => '/tmp/aider-scoped-settings-test',
      getTaskDir: () => '/tmp/aider-scoped-settings-test/task',
      taskId: 'task-id',
      task: { id: 'task-id', mainModel: 'provider/main', weakModel: null, architectModel: null, ...taskModels },
    };
    const store = {
      getSettings: () => ({
        aider: {
          options: '--model legacy/main --weak-model=legacy/weak --editor-model legacy/editor',
          environmentVariables: 'EXAMPLE_GLOBAL=kept\nEXAMPLE_SHARED=global',
          addRuleFiles: false,
          autoCommits: true,
          cachingEnabled: false,
          watchFiles: false,
          confirmBeforeEdit: false,
        },
      }),
      getProjectSettings: () => ({ aider: overrides, modelEditFormats: {} }),
      getProviders: () => [],
    };
    const modelManager = {
      getAiderModelMapping: vi.fn((model: string) => ({ modelName: `mapped/${model}`, environmentVariables: {} })),
    };
    const eventManager = { sendAiderConnectorStatus: vi.fn(), sendUpdateAiderModels: vi.fn() };
    const connector = { listenTo: ['set-models'], sendSetModelsMessage: vi.fn() };
    const installer = { isReady: () => true };
    const manager = new AiderManager(
      task as never,
      store as never,
      modelManager as never,
      eventManager as never,
      () => [connector as never],
      installer as never,
    );
    const internals = manager as unknown as {
      checkAndCleanupPidFile: () => Promise<void>;
      writeAiderProcessPidFile: () => Promise<void>;
    };
    vi.spyOn(internals, 'checkAndCleanupPidFile').mockResolvedValue();
    vi.spyOn(internals, 'writeAiderProcessPidFile').mockResolvedValue();
    vi.mocked(spawn).mockReturnValue({ stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn() } as never);
    return { manager, connector };
  };

  beforeEach(() => vi.clearAllMocks());

  it('launches with project overrides, merged environment variables, and Main as the weak model', async () => {
    const { manager } = setup({
      autoCommits: false,
      watchFiles: true,
      cachingEnabled: true,
      confirmBeforeEdit: true,
      environmentVariables: 'EXAMPLE_SHARED=project',
    });
    await manager.start();
    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    const options = vi.mocked(spawn).mock.calls[0][2];
    expect(args).toContain('--no-auto-commits');
    expect(args).toContain('--watch-files');
    expect(args).toContain('--cache-prompts');
    expect(args[args.indexOf('--weak-model') + 1]).toBe('mapped/provider/main');
    expect(args.filter((arg) => arg.startsWith('legacy/'))).toEqual([]);
    expect(args.filter((arg) => arg.startsWith('--weak-model='))).toEqual([]);
    expect(options?.env?.EXAMPLE_GLOBAL).toBe('kept');
    expect(options?.env?.EXAMPLE_SHARED).toBe('project');
    expect(options?.env?.CONNECTOR_CONFIRM_BEFORE_EDIT).toBe('1');
    expect(manager.getArchitectModel()).toBe('provider/main');
  });

  it('keeps explicit task auxiliary models', async () => {
    const { manager } = setup({}, { weakModel: 'provider/weak', architectModel: 'provider/architect' });
    await manager.start();
    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args[args.indexOf('--weak-model') + 1]).toBe('mapped/provider/weak');
    expect(manager.getArchitectModel()).toBe('provider/architect');
  });

  it('sends Main as Weak when clearing an unlocked weak model during a main-model change', () => {
    const { manager, connector } = setup();
    manager.updateModels('provider/new-main', null);
    expect(connector.sendSetModelsMessage).toHaveBeenCalledWith('mapped/provider/new-main', 'mapped/provider/new-main', 'diff', {});
  });
});
