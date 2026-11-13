import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';

import { GitManager } from '../git-manager';

vi.unmock('fs');
vi.unmock('path');

describe('GitManager getUncommittedDiff', () => {
  let root: string;
  let manager: GitManager;

  beforeEach(async () => {
    vi.stubEnv('GIT_INDEX_FILE', undefined);
    root = await mkdtemp(join(tmpdir(), 'aiderdesk-uncommitted-diff-'));
    const git = simpleGit(root);
    await git.init();
    await git.addConfig('user.name', 'Test');
    await git.addConfig('user.email', 'test@example.invalid');
    await git.addConfig('commit.gpgsign', 'false');
    manager = new GitManager();
  });

  afterEach(async () => {
    try {
      await rm(root, { recursive: true, force: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  const createChanges = async () => {
    const git = simpleGit(root);
    await writeFile(join(root, 'tracked.txt'), 'original\n');
    await writeFile(join(root, 'staged.txt'), 'original staged\n');
    await git.add('.');
    await git.commit('initial commit');
    await writeFile(join(root, 'tracked.txt'), 'unstaged change\n');
    await writeFile(join(root, 'staged.txt'), 'staged change\n');
    await git.add('staged.txt');
    await writeFile(join(root, 'new file.txt'), 'untracked content\n');
  };

  it.each([{ filePaths: undefined }, { filePaths: ['tracked.txt', 'staged.txt', 'new file.txt'] }])(
    'includes all changes with selection $filePaths without modifying the index',
    async ({ filePaths }) => {
      await createChanges();
      const git = simpleGit(root);
      const statusBefore = await git.raw(['status', '--porcelain']);
      const stagedDiffBefore = await git.diff(['--cached']);

      const diff = await manager.getUncommittedDiff(root, filePaths);

      expect(diff).toContain('+unstaged change');
      expect(diff).toContain('+staged change');
      expect(diff).toContain('+untracked content');
      expect(await git.raw(['status', '--porcelain'])).toBe(statusBefore);
      expect(await git.diff(['--cached'])).toBe(stagedDiffBefore);
    },
  );

  it('includes only selected untracked files when HEAD exists', async () => {
    await createChanges();
    await writeFile(join(root, 'unselected.txt'), 'excluded content\n');

    const diff = await manager.getUncommittedDiff(root, ['new file.txt']);

    expect(diff).toContain('+untracked content');
    expect(diff).not.toContain('tracked.txt');
    expect(diff).not.toContain('staged.txt');
    expect(diff).not.toContain('excluded content');
  });

  it('excludes untracked files when only a tracked file is selected', async () => {
    await createChanges();

    const diff = await manager.getUncommittedDiff(root, ['tracked.txt']);

    expect(diff).toContain('+unstaged change');
    expect(diff).not.toContain('+staged change');
    expect(diff).not.toContain('+untracked content');
  });

  it('includes selected staged and untracked files before the first commit', async () => {
    await writeFile(join(root, 'staged.txt'), 'staged content\n');
    await simpleGit(root).add('staged.txt');
    await writeFile(join(root, 'new file.txt'), 'untracked content\n');
    await writeFile(join(root, 'unselected.txt'), 'excluded content\n');

    const diff = await manager.getUncommittedDiff(root, ['staged.txt', 'new file.txt']);

    expect(diff).toContain('+staged content');
    expect(diff).toContain('+untracked content');
    expect(diff).not.toContain('excluded content');
  });

  it('returns null when there are no changes', async () => {
    await writeFile(join(root, 'tracked.txt'), 'original\n');
    const git = simpleGit(root);
    await git.add('.');
    await git.commit('initial commit');

    expect(await manager.getUncommittedDiff(root)).toBeNull();
  });
});
