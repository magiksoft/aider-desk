import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectApi } from '../project-api';

import type { EventsHandler } from '@/events-handler';

vi.mock('@/logger', () => ({ default: { error: vi.fn() } }));

describe('archived task listing REST API', () => {
  let server: Server;
  let url: string;
  const getTasks = vi.fn(async () => []);
  const reloadTasks = vi.fn(async () => []);

  beforeEach(async () => {
    vi.clearAllMocks();
    const app = express();
    app.use(express.json());
    const router = express.Router();
    new ProjectApi({ getTasks, reloadTasks } as unknown as EventsHandler).registerRoutes(router);
    app.use('/api', router);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/project/tasks`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it.each([false, true])('forwards includeArchived=%s from query parameters', async (includeArchived) => {
    const response = await fetch(`${url}?projectDir=/project&includeArchived=${includeArchived}`);
    expect(response.status).toBe(200);
    expect(getTasks).toHaveBeenCalledWith('/project', includeArchived);
  });

  it('preserves complete listings for external clients that omit the option', async () => {
    expect((await fetch(`${url}?projectDir=/project`)).status).toBe(200);
    expect(getTasks).toHaveBeenCalledWith('/project', true);
  });

  it('rejects invalid archive filter values', async () => {
    expect((await fetch(`${url}?projectDir=/project&includeArchived=invalid`)).status).toBe(400);
    expect(getTasks).not.toHaveBeenCalled();
  });

  it.each([false, true])('forwards includeArchived=%s when reloading', async (includeArchived) => {
    const response = await fetch(`${url}/reload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir: '/project', includeArchived }),
    });
    expect(response.status).toBe(200);
    expect(reloadTasks).toHaveBeenCalledWith('/project', includeArchived);
  });
});
