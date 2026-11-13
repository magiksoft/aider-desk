import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_TASK_STATE_DEFINITIONS } from '@common/task-states';

import { ExtensionsApi } from '../extensions-api';
import { ReadonlyApi } from '../readonly-api';

import type { EventsHandler } from '@/events-handler';
import type { ProjectManager } from '@/project';
import type { Store } from '@/store';

const projectDir = '/configured/project';
const definitions = [...BUILT_IN_TASK_STATE_DEFINITIONS, { id: 'custom', name: 'Custom', color: '#abc', priority: 90 }];

describe('task-state API transport', () => {
  let server: Server;
  let baseUrl: string;
  const getTaskStateDefinitions = vi.fn(() => definitions);
  const getOpenProject = vi.fn((dir: string) => (dir === projectDir ? { baseDir: projectDir } : undefined));
  const getProject = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    const app = express();
    const eventsHandler = { getTaskStateDefinitions } as unknown as EventsHandler;
    const projectManager = { getOpenProject, getProject } as unknown as ProjectManager;
    const standard = express.Router();
    new ExtensionsApi(eventsHandler, projectManager).registerRoutes(standard);
    app.use('/api', standard);
    const readonly = express.Router();
    new ReadonlyApi(
      projectManager,
      eventsHandler,
      { getSettings: () => ({ server: { readonly: true, readonlyExtensionUi: false } }) } as Store,
      () => true,
    ).registerRoutes(readonly);
    app.use('/readonly', readonly);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it.each([undefined, projectDir])('forwards the standard API project scope %s', async (scope) => {
    const response = await fetch(`${baseUrl}/api/extensions/task-states${scope ? `?projectDir=${encodeURIComponent(scope)}` : ''}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(definitions);
    expect(getTaskStateDefinitions).toHaveBeenCalledWith(scope);
    expect(getProject).not.toHaveBeenCalled();
    if (scope === undefined) {
      expect(getOpenProject).not.toHaveBeenCalled();
    } else {
      expect(getOpenProject).toHaveBeenCalledWith(scope);
    }
  });

  it('returns the standard 404 for unknown scopes without collecting definitions or creating projects', async () => {
    const response = await fetch(`${baseUrl}/api/extensions/task-states?projectDir=/other`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Project not found',
      message: "Project directory '/other' does not exist",
    });
    expect(getOpenProject).toHaveBeenCalledWith('/other');
    expect(getTaskStateDefinitions).not.toHaveBeenCalled();
    expect(getProject).not.toHaveBeenCalled();
  });

  it('serves readonly state metadata even when executable extension UI is disabled', async () => {
    const response = await fetch(`${baseUrl}/readonly/extensions/task-states?projectDir=${encodeURIComponent(projectDir)}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(definitions);
    expect(getTaskStateDefinitions).toHaveBeenCalledWith(projectDir);
  });

  it('rejects unknown readonly projects before collecting contributions', async () => {
    const response = await fetch(`${baseUrl}/readonly/extensions/task-states?projectDir=/other`);
    expect(response.status).toBe(404);
    expect(getTaskStateDefinitions).not.toHaveBeenCalled();
  });
});
