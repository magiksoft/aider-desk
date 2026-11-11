import { describe, expect, it, vi } from 'vitest';
import { ProjectSettings, SettingsData } from '@common/types';

import { Task } from '../task';

vi.mock('@/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils')>()),
  getEnvironmentVariablesForAider: vi.fn((settings: SettingsData) => ({ EXAMPLE_ENV: settings.aider.environmentVariables })),
}));

const settings = {
  aider: {
    options: '',
    environmentVariables: 'GLOBAL_ONLY=global',
    addRuleFiles: true,
    autoCommits: true,
    cachingEnabled: false,
    watchFiles: false,
    confirmBeforeEdit: false,
  },
} as SettingsData;

const setup = (projectSettings: Partial<ProjectSettings> = {}) => {
  const start = vi.fn().mockResolvedValue(undefined);
  const sendUpdateEnvVars = vi.fn();
  const task: Task = Object.assign(Object.create(Task.prototype), {
    taskId: 'task',
    task: { mainModel: 'provider/selected', weakModel: null },
    initialized: true,
    project: { baseDir: '/project' },
    store: { getSettings: () => settings, getProjectSettings: () => projectSettings },
    shouldStartAider: vi.fn().mockResolvedValue(true),
    aiderManager: { start, handleConnectorAdded: vi.fn() },
    sendUpdateEnvVars,
    connectors: [],
  });
  return { task, start, sendUpdateEnvVars };
};

describe('Task scoped Aider runtime settings', () => {
  it('does not restart when a global change is masked by a project override', async () => {
    const { task, start } = setup({ aider: { autoCommits: false } });
    await task.settingsChanged(settings, { ...settings, aider: { ...settings.aider, autoCommits: false } });
    expect(start).not.toHaveBeenCalled();
  });

  it('restarts for a project option override without replacing task model selections', async () => {
    const { task, start } = setup();
    await task.projectSettingsChanged({} as ProjectSettings, { aider: { autoCommits: false } } as ProjectSettings);
    expect(start).toHaveBeenCalledWith(true);
    expect(task.task.mainModel).toBe('provider/selected');
    expect(task.task.weakModel).toBeNull();
  });

  it('restarts when removing project environment variables, preventing stale keys in the Python process', async () => {
    const { task, start } = setup();
    await task.projectSettingsChanged({ aider: { environmentVariables: 'PROJECT_ONLY=value' } } as ProjectSettings, {} as ProjectSettings);
    expect(start).toHaveBeenCalledWith(true);
  });

  it('uses project-resolved environment variables when a connector attaches', () => {
    const { task, sendUpdateEnvVars } = setup({ aider: { environmentVariables: 'PROJECT_ONLY=project' } });
    task.addConnector({ taskId: 'task', listenTo: ['update-env-vars'] } as never);
    expect(sendUpdateEnvVars).toHaveBeenCalledWith({ EXAMPLE_ENV: 'GLOBAL_ONLY=global\nPROJECT_ONLY=project' });
  });
});
