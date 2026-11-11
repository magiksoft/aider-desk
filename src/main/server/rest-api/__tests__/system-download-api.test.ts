import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SystemApi } from '../system-api';

import type { EventsHandler } from '@/events-handler';
import type { PythonDependenciesInstaller } from '@/python-dependencies-installer';

describe('system file downloads', () => {
  let server: Server;
  let url: string;
  let directory: string;
  const submit = (path: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'aiderdesk-download-'));
    const app = express();
    app.use(express.json());
    const router = express.Router();
    new SystemApi({} as EventsHandler, {} as PythonDependenciesInstaller).registerRoutes(router);
    app.use('/api', router);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/system/download-file`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(directory, { recursive: true, force: true });
  });

  it('sends binary bytes as an attachment without rendering HTML', async () => {
    const path = join(directory, 'my mockup.html');
    const bytes = Buffer.from([0, 255, 128, 60, 104, 116, 109, 108, 62]);
    await writeFile(path, bytes);
    const response = await submit(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment;');
    expect(response.headers.get('content-disposition')).toContain('my mockup.html');
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it('supports files in hidden directories such as .agent', async () => {
    const hiddenDir = join(directory, '.agent');
    await mkdir(hiddenDir);
    const path = join(hiddenDir, 'mockup.html');
    await writeFile(path, 'mockup');
    const response = await submit(path);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('mockup');
  });

  it.each([undefined, '', 42, '../secret', 'file:///tmp/file', '/tmp/bad\0file'])('rejects invalid path %s', async (path) => {
    expect((await submit(path)).status).toBe(400);
  });

  it('rejects directories', async () => {
    expect((await submit(directory)).status).toBe(404);
  });

  it('reports missing files', async () => {
    expect((await submit(join(directory, 'missing'))).status).toBe(404);
  });
});
