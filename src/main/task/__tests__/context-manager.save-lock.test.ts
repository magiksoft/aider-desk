import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextManager } from '../context-manager';

const mocks = vi.hoisted(() => ({
  writes: [] as Array<{ path: string; resolve: () => void }>,
}));

vi.mock('@/utils/atomic-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/atomic-write')>();
  return {
    ...actual,
    atomicWriteJsonFile: vi.fn((filePath: string) => {
      let resolve: (value: void) => void = () => undefined;
      const promise = new Promise<void>((res) => {
        resolve = res;
      });
      mocks.writes.push({ path: filePath, resolve });
      return promise;
    }),
  };
});

const createTask = (projectDir: string) => ({
  getProjectDir: () => projectDir,
  getTaskDir: () => projectDir,
  sendContextInfoUpdated: vi.fn(),
});

describe('ContextManager - save lock isolation', () => {
  let projectDirA: string;
  let projectDirB: string;

  beforeEach(async () => {
    projectDirA = await fs.mkdtemp(path.join(os.tmpdir(), 'aider-desk-lock-a-'));
    projectDirB = await fs.mkdtemp(path.join(os.tmpdir(), 'aider-desk-lock-b-'));
    mocks.writes = [];
  });

  afterEach(async () => {
    await fs.rm(projectDirA, { recursive: true, force: true });
    await fs.rm(projectDirB, { recursive: true, force: true });
  });

  it('does not share the save lock between projects with the same task id', async () => {
    const managerA = new ContextManager(createTask(projectDirA) as never, 'internal');
    const managerB = new ContextManager(createTask(projectDirB) as never, 'internal');

    const saveA = managerA.save();
    const saveB = managerB.save();

    await vi.waitFor(() => expect(mocks.writes).toHaveLength(2));

    const writeA = mocks.writes.find((write) => write.path.startsWith(projectDirA));
    const writeB = mocks.writes.find((write) => write.path.startsWith(projectDirB));
    expect(writeA).toBeDefined();
    expect(writeB).toBeDefined();

    writeB!.resolve();
    await expect(saveB).resolves.toBeUndefined();

    writeA!.resolve();
    await expect(saveA).resolves.toBeUndefined();
  });
});
