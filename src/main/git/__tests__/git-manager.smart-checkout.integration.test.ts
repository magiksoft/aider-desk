import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';

import { GitManager } from '../git-manager';

import * as utils from '@/utils';

vi.unmock('fs');
vi.unmock('path');

const originalContent = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n';

describe('Smart Checkout', () => {
  let projectPath: string;
  let manager: GitManager;

  const write = async (file: string, content: string) => await writeFile(join(projectPath, file), content);
  const read = async (file: string) => await readFile(join(projectPath, file), 'utf8');

  beforeEach(async () => {
    vi.stubEnv('GIT_INDEX_FILE', undefined);
    projectPath = await mkdtemp(join(tmpdir(), 'aiderdesk-smart-checkout-'));
    manager = new GitManager();
    const git = simpleGit(projectPath);
    await git.init();
    await git.addConfig('user.name', 'Test');
    await git.addConfig('user.email', 'test@example.invalid');
    await git.addConfig('commit.gpgsign', 'false');
    await git.checkoutLocalBranch('main');
    await write('file.txt', originalContent);
    await git.add('.');
    await git.commit('initial');
    await git.checkoutLocalBranch('feature');
    await write('file.txt', originalContent.replace('one', 'feature'));
    await git.add('.');
    await git.commit('feature change');
    await git.checkout('main');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(projectPath, { recursive: true, force: true });
  });

  it('offers Smart Checkout without modifying the working tree or index', async () => {
    const git = simpleGit(projectPath);
    await write('file.txt', originalContent.replace('seven', 'local'));
    await git.add('file.txt');
    const status = await git.raw(['status', '--porcelain']);

    expect(await manager.checkoutBranch(projectPath, 'feature')).toEqual({ requiresSmartCheckout: true });

    expect((await git.status()).current).toBe('main');
    expect(await git.raw(['status', '--porcelain'])).toBe(status);
    expect(await read('file.txt')).toContain('local');
    expect(await git.raw(['stash', 'list'])).toBe('');
  });

  it('merges edits and restores untracked files without changing existing stashes', async () => {
    const git = simpleGit(projectPath);
    await write('older.txt', 'older stash');
    await git.raw(['stash', 'push', '-u', '-m', 'existing stash']);
    const olderStash = await git.revparse(['refs/stash']);
    await write('file.txt', originalContent.replace('seven', 'local'));
    await write('untracked.txt', 'untracked work');

    expect(await manager.checkoutBranch(projectPath, 'feature', false, false, true)).toEqual({});

    expect((await git.status()).current).toBe('feature');
    expect(await read('file.txt')).toBe(originalContent.replace('one', 'feature').replace('seven', 'local'));
    expect(await read('untracked.txt')).toBe('untracked work');
    expect(await git.revparse(['refs/stash'])).toBe(olderStash);
    expect((await git.stashList()).total).toBe(1);
  });

  it('returns conflicted files on the destination branch and retains the original snapshot', async () => {
    const git = simpleGit(projectPath);
    await write('file.txt', originalContent.replace('one', 'local'));
    await git.add('file.txt');
    await write('untracked.txt', 'untracked work');

    const result = await manager.checkoutBranch(projectPath, 'feature', false, false, true);

    expect(result.conflictedFiles).toEqual(['file.txt']);
    expect(result.backupRef).toMatch(/^[a-f0-9]{40,64}$/);
    expect((await git.status()).current).toBe('feature');
    expect((await git.status()).conflicted).toEqual(['file.txt']);
    expect(await read('untracked.txt')).toBe('untracked work');
    expect(await git.show([`${result.backupRef}:file.txt`])).toContain('local');
    expect(await git.show([`${result.backupRef}^3:untracked.txt`])).toBe('untracked work');
  });

  it('restores staged, unstaged, and untracked changes if checkout fails after stashing', async () => {
    const git = simpleGit(projectPath);
    await write('file.txt', originalContent.replace('seven', 'staged'));
    await git.add('file.txt');
    await write('file.txt', originalContent.replace('seven', 'unstaged'));
    await write('untracked.txt', 'untracked work');
    const originalStatus = await git.raw(['status', '--porcelain']);
    const originalIndex = await git.show([':file.txt']);
    const realExec = utils.execWithShellPath;
    let checkoutCalls = 0;
    vi.spyOn(utils, 'execWithShellPath').mockImplementation(async (...args) => {
      if (args[0] === "git checkout 'feature'" && ++checkoutCalls === 2) {
        throw new Error('Simulated checkout failure');
      }
      return await realExec(...args);
    });

    await expect(manager.checkoutBranch(projectPath, 'feature', false, false, true)).rejects.toThrow('original changes were restored');

    expect((await git.status()).current).toBe('main');
    expect(await git.raw(['status', '--porcelain'])).toBe(originalStatus);
    expect(await git.show([':file.txt'])).toBe(originalIndex);
    expect(await read('file.txt')).toContain('unstaged');
    expect(await read('untracked.txt')).toBe('untracked work');
    expect((await git.stashList()).total).toBe(1);
  });

  it('keeps untracked collisions recoverable without overwriting destination files', async () => {
    const git = simpleGit(projectPath);
    await git.checkout('feature');
    await write('collision.txt', 'destination content');
    await git.add('.');
    await git.commit('destination file');
    await git.checkout('main');
    await write('collision.txt', 'local content');

    await expect(manager.checkoutBranch(projectPath, 'feature', false, false, true)).rejects.toThrow('could not fully restore');

    expect((await git.status()).current).toBe('feature');
    expect(await read('collision.txt')).toBe('destination content');
    const stash = (await git.revparse(['refs/stash'])).trim();
    expect(await git.show([`${stash}^3:collision.txt`])).toBe('local content');
  });

  it('does not apply the source index onto the target if checkout changed HEAD before reporting failure', async () => {
    const git = simpleGit(projectPath);
    await write('file.txt', originalContent.replace('seven', 'local'));
    const realExec = utils.execWithShellPath;
    let checkoutCalls = 0;
    vi.spyOn(utils, 'execWithShellPath').mockImplementation(async (...args) => {
      const result = await realExec(...args);
      if (args[0] === "git checkout 'feature'" && ++checkoutCalls === 1) {
        throw new Error('Simulated post-checkout hook failure');
      }
      return result;
    });

    await expect(manager.checkoutBranch(projectPath, 'feature', false, false, true)).rejects.toThrow('after changing HEAD');

    expect((await git.status()).current).toBe('feature');
    expect((await git.status()).isClean()).toBe(true);
    expect(await git.show(['refs/stash:file.txt'])).toContain('local');
  });
});
