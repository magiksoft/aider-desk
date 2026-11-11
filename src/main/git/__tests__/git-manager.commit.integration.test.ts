import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';

import { GitManager } from '../git-manager';

vi.unmock('fs');
vi.unmock('path');

describe('GitManager selective amend', () => {
  let root: string;
  let manager: GitManager;

  beforeEach(async () => {
    vi.stubEnv('GIT_INDEX_FILE', undefined);
    root = await mkdtemp(join(tmpdir(), 'aiderdesk-amend-'));
    const git = simpleGit(root);
    await git.init();
    await git.addConfig('user.name', 'Test');
    await git.addConfig('user.email', 'test@example.invalid');
    await git.addConfig('commit.gpgsign', 'false');
    await writeFile(join(root, 'selected.txt'), 'original selected');
    await writeFile(join(root, 'unselected.txt'), 'original unselected');
    await git.add('.');
    await git.commit('original message');
    await writeFile(join(root, 'selected.txt'), 'selected change');
    await writeFile(join(root, 'unselected.txt'), 'unselected staged change');
    await git.add('unselected.txt');
    manager = new GitManager();
  });

  afterEach(async () => {
    try {
      await rm(root, { recursive: true, force: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each(['', 'updated message'])('amends only selected changes with message %j', async (message) => {
    expect(await manager.commitChanges(root, message, true, false, ['selected.txt'])).toBe(true);

    const git = simpleGit(root);
    expect(await git.show(['HEAD:selected.txt'])).toBe('selected change');
    expect(await git.show(['HEAD:unselected.txt'])).toBe('original unselected');
    expect((await git.diff(['--cached', '--name-only'])).trim()).toBe('unselected.txt');
    expect((await git.log()).latest?.message).toBe(message || 'original message');
  });

  it('amends only the message when no files are selected', async () => {
    expect(await manager.commitChanges(root, 'message only', true, false, [])).toBe(true);

    const git = simpleGit(root);
    expect(await git.show(['HEAD:selected.txt'])).toBe('original selected');
    expect(await git.show(['HEAD:unselected.txt'])).toBe('original unselected');
    expect((await git.diff(['--cached', '--name-only'])).trim()).toBe('unselected.txt');
    expect((await git.log()).latest?.message).toBe('message only');
  });
});
