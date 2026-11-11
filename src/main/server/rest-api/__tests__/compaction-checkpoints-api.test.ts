import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectApi } from '../project-api';

import type { EventsHandler } from '@/events-handler';

vi.mock('@/logger', () => ({ default: { error: vi.fn() } }));

describe('compaction checkpoint REST API', () => {
  let server: Server;
  let url: string;
  const undoContextChange = vi.fn(async () => true);
  const forkTaskFromCheckpoint = vi.fn(async () => ({ id: 'fork' }));
  const submit = (checkpointId?: string) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir: '/project', taskId: 'task', checkpointId }),
    });

  beforeEach(async () => {
    undoContextChange.mockClear();
    forkTaskFromCheckpoint.mockClear();
    const app = express();
    app.use(express.json());
    const router = express.Router();
    new ProjectApi({ undoContextChange, forkTaskFromCheckpoint } as unknown as EventsHandler).registerRoutes(router);
    app.use('/api', router);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/project/undo-context-change`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it.each([undefined, 'context.pre-compaction.001.json'])('forwards checkpoint %s without changing legacy undo behavior', async (checkpointId) => {
    const response = await submit(checkpointId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ undone: true });
    expect(undoContextChange).toHaveBeenCalledWith('/project', 'task', checkpointId);
  });

  it.each(['../context.json', '/tmp/context.pre-compaction.001.json', 'context.json', ''])('rejects invalid checkpoint %s', async (checkpointId) => {
    expect((await submit(checkpointId)).status).toBe(400);
    expect(undoContextChange).not.toHaveBeenCalled();
  });
  it('forks from a validated checkpoint', async () => {
    url = url.replace('/project/undo-context-change', '/project/tasks/fork-from-checkpoint');
    const response = await submit('context.pre-compaction.002.json');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'fork' });
    expect(forkTaskFromCheckpoint).toHaveBeenCalledWith('/project', 'task', 'context.pre-compaction.002.json');
    expect(undoContextChange).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '../context.pre-compaction.001.json', '/tmp/context.pre-compaction.001.json', 'context.json'])(
    'rejects invalid fork checkpoint %s',
    async (checkpointId) => {
      url = url.replace('/project/undo-context-change', '/project/tasks/fork-from-checkpoint');
      expect((await submit(checkpointId)).status).toBe(400);
      expect(forkTaskFromCheckpoint).not.toHaveBeenCalled();
    },
  );
});
