import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readTaskImage } from '../read-task-image';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let directory: string;
let taskDir: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'task-image-'));
  taskDir = join(directory, 'worktree');
  await mkdir(join(taskDir, 'agent-browser-screenshots'), { recursive: true });
  await writeFile(join(taskDir, 'agent-browser-screenshots', 'magiksoft.png'), png);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('readTaskImage', () => {
  it('loads a relative screenshot from the task working directory', async () => {
    await expect(readTaskImage(taskDir, 'agent-browser-screenshots/magiksoft.png')).resolves.toBe(`data:image/png;base64,${png.toString('base64')}`);
  });

  it('loads absolute paths within the task directory', async () => {
    await expect(readTaskImage(taskDir, join(taskDir, 'agent-browser-screenshots/magiksoft.png'))).resolves.toContain('data:image/png;base64,');
  });

  it('rejects traversal and absolute paths outside the task directory', async () => {
    const outside = join(directory, 'outside.png');
    await writeFile(outside, png);
    await expect(readTaskImage(taskDir, '../outside.png')).rejects.toThrow('inside the task directory');
    await expect(readTaskImage(taskDir, outside)).rejects.toThrow('inside the task directory');
  });

  it.skipIf(process.platform === 'win32')('rejects symlinks outside the task directory', async () => {
    const outside = join(directory, 'outside.png');
    await writeFile(outside, png);
    await symlink(outside, join(taskDir, 'linked.png'));
    await expect(readTaskImage(taskDir, 'linked.png')).rejects.toThrow('inside the task directory');
  });

  it('rejects files disguised as images and active SVG content', async () => {
    await writeFile(join(taskDir, 'fake.png'), '<html>not an image</html>');
    await writeFile(join(taskDir, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await expect(readTaskImage(taskDir, 'fake.png')).rejects.toThrow('Unsupported image format');
    await expect(readTaskImage(taskDir, 'image.svg')).rejects.toThrow('Unsupported image format');
  });

  it('rejects oversized files, directories, missing files, and invalid paths', async () => {
    await writeFile(join(taskDir, 'large.png'), Buffer.alloc(20 * 1024 * 1024 + 1));
    await expect(readTaskImage(taskDir, 'large.png')).rejects.toThrow('20 MB');
    await expect(readTaskImage(taskDir, 'agent-browser-screenshots')).rejects.toThrow('regular file');
    await expect(readTaskImage(taskDir, 'missing.png')).rejects.toThrow();
    await expect(readTaskImage(taskDir, 'bad\0.png')).rejects.toThrow('Invalid image path');
  });
});
