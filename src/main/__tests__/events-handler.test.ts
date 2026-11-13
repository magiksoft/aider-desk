import { describe, expect, it, vi } from 'vitest';

import { EventsHandler } from '../events-handler';

import type { AgentProfileManager } from '@/agent';
import type { Store } from '@/store';
import type { ModelManager } from '@/models';
import type { TelemetryManager } from '@/telemetry';
import type { ProjectData } from '@common/types';
import type { ProjectManager } from '@/project';
import type { ExtensionManager } from '@/extensions';

describe('EventsHandler', () => {
  it('uses the default agent profile when the active project profile is scoped to another project', async () => {
    const activeProject = {
      baseDir: '/previous-project',
      active: true,
      settings: {
        agentProfileId: 'previous-project-profile',
      },
    } as unknown as ProjectData;
    const store = {
      getOpenProjects: vi.fn(() => [activeProject]),
      setOpenProjects: vi.fn(),
    } as unknown as Store;
    const modelManager = {
      getProviderModels: vi.fn().mockResolvedValue({ models: [] }),
    } as unknown as ModelManager;
    const telemetryManager = {
      captureProjectOpened: vi.fn(),
    } as unknown as TelemetryManager;
    const agentProfileManager = {
      getDefaultAgentProfileId: vi.fn(() => 'default-profile'),
      getProfile: vi.fn(() => ({ id: 'previous-project-profile', projectDir: '/previous-project' })),
    } as unknown as AgentProfileManager;
    const eventsHandler = new EventsHandler(
      {} as never,
      store,
      {} as never,
      {} as never,
      {} as never,
      modelManager,
      telemetryManager,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      agentProfileManager,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await eventsHandler.addOpenProject('/new-project');

    expect(store.setOpenProjects).toHaveBeenCalledWith([
      { ...activeProject, active: false },
      expect.objectContaining({
        baseDir: '/new-project',
        active: true,
        settings: expect.objectContaining({ agentProfileId: 'default-profile' }),
      }),
    ]);
  });
});

describe('EventsHandler task-state metadata', () => {
  it.each([undefined, '/known', '/missing'])('resolves scope %s without creating projects', (scope) => {
    const project = { baseDir: '/known' };
    const getOpenProject = vi.fn((dir: string) => (dir === project.baseDir ? project : undefined));
    const getProject = vi.fn();
    const definitions = [{ id: 'custom', name: 'Custom', color: '#abc', priority: 25 }];
    const getTaskStateDefinitions = vi.fn(() => definitions);
    const handler = new EventsHandler(
      { getOpenProject, getProject } as unknown as ProjectManager,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getTaskStateDefinitions } as unknown as ExtensionManager,
      {} as never,
      {} as never,
    );

    if (scope === '/missing') {
      expect(() => handler.getTaskStateDefinitions(scope)).toThrow('Project not found');
      expect(getTaskStateDefinitions).not.toHaveBeenCalled();
    } else {
      expect(handler.getTaskStateDefinitions(scope)).toEqual(definitions);
      expect(getTaskStateDefinitions).toHaveBeenCalledExactlyOnceWith(scope === undefined ? undefined : project);
    }
    if (scope === undefined) {
      expect(getOpenProject).not.toHaveBeenCalled();
    } else {
      expect(getOpenProject).toHaveBeenCalledExactlyOnceWith(scope);
    }
    expect(getProject).not.toHaveBeenCalled();
  });
});
