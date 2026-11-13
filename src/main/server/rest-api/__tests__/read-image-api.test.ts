import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectApi } from '../project-api';

import type { EventsHandler } from '@/events-handler';

const content = 'data:image/png;base64,cG5n';
const readImage = vi.fn();
let server: Server;
let url: string;

beforeEach(async () => {
  readImage.mockReset().mockResolvedValue(content);
  const app = express();
  app.use(express.json());
  const router = express.Router();
  new ProjectApi({ readImage } as unknown as EventsHandler).registerRoutes(router);
  app.use('/api', router);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/project/read-image`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe('read image API', () => {
  it('returns validated image data for a task', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir: '/project', taskId: 'task', filePath: 'screenshots/image.png' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ content });
    expect(readImage).toHaveBeenCalledWith('/project', 'task', 'screenshots/image.png');
  });

  it('rejects requests without a task identity', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir: '/project', filePath: 'screenshots/image.png' }),
    });
    expect(response.status).toBe(400);
    expect(readImage).not.toHaveBeenCalled();
  });
});
